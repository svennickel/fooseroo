import { supabase } from './supabase'
import { groupHash, decodeMatch, decodeTraining } from './share'

export type SharedMatch = {
  homeName: string
  awayName: string
  setsHome: number
  setsAway: number
  state: unknown
  groupName: string
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
      .select('home_name,away_name,sets_home,sets_away,state,created_at,deleted_at')
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
        groupName: (g as { name?: string }).name ?? ''
      }
    }
  } catch {
    return { status: 'error' }
  }
}

// Parse the hash route: #/m/<token> (match) or #/t/<token> (training).
export type Route =
  | { type: 'match'; token: string }
  | { type: 'training'; token: string }
  | { type: 'home' }

export function parseRoute(hash: string): Route {
  const m = hash.match(/^#\/m\/([0-9a-zA-Z]+)/)
  if (m) return { type: 'match', token: m[1] }
  const t = hash.match(/^#\/t\/([0-9a-zA-Z]+)/)
  if (t) return { type: 'training', token: t[1] }
  return { type: 'home' }
}

// Re-export for the training view (resolved like a match, by group hash + day).
export { decodeTraining }
