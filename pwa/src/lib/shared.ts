import { supabase } from './supabase'
import { groupHash, decodeMatch, decodeTraining } from './share'

export type SharedMatch = {
  homeName: string
  awayName: string
  setsHome: number
  setsAway: number
  state: unknown
  groupName: string
  groupId: string
  category: string | null
  at: number       // created_at epoch ms
  running: boolean
}

export type Resolution<T> =
  | { status: 'ok'; data: T }
  | { status: 'auth' }       // signed-out: offer sign-in, then retry
  | { status: 'notfound' }   // bad token, or not a member of the group
  | { status: 'error' }

// Find the group (among the signed-in user's groups, via RLS) whose hash matches
// the token's, then fetch the shared match. created_at carries the match's
// timestamp; matched with a small tolerance against Postgres timestamptz rounding.
export async function resolveSharedMatch(token: string): Promise<Resolution<SharedMatch>> {
  const dec = decodeMatch(token)
  if (!dec) return { status: 'notfound' }
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return { status: 'auth' }
  try {
    const { data: groups, error: gErr } = await supabase.from('groups').select('id,name')
    if (gErr) return { status: 'error' }
    const g = (groups ?? []).find((x: { id: string }) => groupHash(x.id) === dec.groupHash)
    if (!g) return { status: 'notfound' }
    const { data: rows, error: mErr } = await supabase
      .from('matches')
      .select('home_name,away_name,sets_home,sets_away,category,running,state,created_at,deleted_at')
      .eq('group_id', g.id)
    if (mErr) return { status: 'error' }
    const row = (rows ?? []).find(
      (r: { created_at: string | null; deleted_at: string | null }) =>
        r.deleted_at == null &&
        r.created_at != null &&
        Math.abs(Date.parse(r.created_at) - dec.timestampMillis) < 1000
    )
    if (!row) return { status: 'notfound' }
    return {
      status: 'ok',
      data: {
        homeName: row.home_name ?? '–',
        awayName: row.away_name ?? '–',
        setsHome: row.sets_home ?? 0,
        setsAway: row.sets_away ?? 0,
        state: row.state,
        groupName: (g as { name?: string }).name ?? '',
        groupId: g.id,
        category: row.category ?? null,
        at: row.created_at ? Date.parse(row.created_at) : 0,
        running: row.running ?? false
      }
    }
  } catch {
    return { status: 'error' }
  }
}

// Parse the hash route: #/m/<token> (match), #/t/<token> (training), or
// #/g/<CODE> (join a training group by code, mirroring the app's fooseroo.app/g/…).
export type Route =
  | { type: 'match'; token: string }
  | { type: 'training'; token: string }
  | { type: 'join'; code: string }
  | { type: 'home' }

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/m\/([0-9a-zA-Z]+)/)
  if (m) return { type: 'match', token: m[1] }
  const t = hash.match(/^#\/t\/([0-9a-zA-Z]+)/)
  if (t) return { type: 'training', token: t[1] }
  const j = hash.match(/^#\/g\/([0-9A-Za-z-]*)/)
  if (j) return { type: 'join', code: j[1] }
  return { type: 'home' }
}

// Join a training group via its short code, mirroring the app's join_with_code RPC
// (server-normalized + throttled). Requires a signed-in account.
export type JoinResult =
  | { status: 'ok'; groupId: string }
  | { status: 'auth' }       // signed-out: prompt sign-in, then retry
  | { status: 'invalid' }    // unknown / disabled / expired code
  | { status: 'throttled' }
  | { status: 'full' }
  | { status: 'error' }

// Resolve a join code to the group's name + retention WITHOUT joining (and without
// membership), so the invite view can show "Join «Name» — results auto-deleted after
// N days" before joining. Mirrors the Android invite preview. null = invalid/unknown.
export type InvitePreview = { id: string | null; name: string; retentionDays: number | null; retentionTz: string | null }
export async function groupInvitePreview(code: string): Promise<InvitePreview | null> {
  try {
    const { data, error } = await supabase.rpc('group_invite_preview', { p_code: code })
    if (error) return null
    const row = (Array.isArray(data) ? data[0] : data) as
      { id?: string; name?: string; retention_days?: number | null; retention_tz?: string | null } | null
    if (!row || !row.name) return null
    return { id: row.id ?? null, name: row.name, retentionDays: row.retention_days ?? null, retentionTz: row.retention_tz ?? null }
  } catch {
    return null
  }
}

export async function joinWithCode(code: string): Promise<JoinResult> {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return { status: 'auth' }
  try {
    const { data, error } = await supabase.rpc('join_with_code', { p_code: code })
    if (error) {
      const m = (error.message || '').toLowerCase()
      if (m.includes('too_many_attempts')) return { status: 'throttled' }
      if (m.includes('invalid_or_expired')) return { status: 'invalid' }
      if (m.includes('group_full')) return { status: 'full' }
      if (m.includes('not_authenticated')) return { status: 'auth' }
      return { status: 'error' }
    }
    return { status: 'ok', groupId: data as string }
  } catch {
    return { status: 'error' }
  }
}

// Re-export for the training view (resolved like a match, by group hash + day).
export { decodeTraining }
