import { supabase } from './supabase'

export type Group = { id: string; name: string; ownerId: string | null }

// The signed-in user's training groups (RLS limits to memberships). ownerId lets the
// UI hide "leave" for the owner (who deletes the group instead, like the app).
export async function loadGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from('groups').select('id,name,owner_id')
  if (error) throw error
  return (data ?? []).map((g: { id: string; name: string | null; owner_id: string | null }) =>
    ({ id: g.id, name: g.name ?? '—', ownerId: g.owner_id ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))   // alphabetical

}

// The context's match categories as synced by the app (app_config, key
// "match_categories", group-prefixed) — NOT just the ones that already have a
// match. Mirrors CloudConfig so the web's category picker offers exactly the same
// list (e.g. "Rangliste" before its first match). Best-effort → [] on any error.
export async function loadCategories(ctx: Ctx = null): Promise<string[]> {
  try {
    const key = `${ctx ? `g:${ctx}:` : ''}match_categories`
    let q = supabase.from('app_config').select('value').eq('key', key)
    q = ctx == null ? q.is('group_id', null) : q.eq('group_id', ctx)
    const { data, error } = await q
    if (error || !data) return []
    const out = new Set<string>()
    for (const row of data as { value: unknown }[]) {
      const v = row.value
      if (Array.isArray(v)) for (const s of v) if (typeof s === 'string' && s.trim()) out.add(s)
    }
    return [...out]
  } catch { return [] }
}

// Write the context's match-category list to app_config (key match_categories,
// group-prefixed), mirroring CloudConfig. The app's config sync is additive, so a
// removal here can be re-added by an app device that still has it locally — adds,
// renames (which also move the matches) and reordering are the durable parts.
export async function saveCategories(ctx: Ctx, list: string[]): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const key = `${ctx ? `g:${ctx}:` : ''}match_categories`
  const { error } = await supabase.from('app_config')
    .upsert({ owner_id: uid, group_id: ctx, key, value: list }, { onConflict: 'owner_id,key' })
  if (error) throw error
}

// Move every match of category `from` to `to` in this context (used by rename and
// by delete-with-reassign). RLS limits the update to rows the user may write.
export async function reassignCategory(ctx: Ctx, from: string, to: string): Promise<void> {
  let q = supabase.from('matches').update({ category: to }).eq('category', from)
  q = ctx == null ? q.is('group_id', null) : q.eq('group_id', ctx)
  const { error } = await q
  if (error) throw error
}

// ---- Player pool (shared people for matches + training), synced like the app ----
// The app keeps ONE pool (PlayerPool, prefs "time_measure_names") and syncs it to
// app_config two ways: CloudPlayerPool → key "player_pool[:gid]" value {items:[…]},
// and CloudConfig → key "[g:gid:]time_measure_names" value […] (a bare array). We
// read the UNION of both (+ a group's member display names, like the app) and, on
// add, write BOTH keys so any app/web reader converges immediately. UNION merge —
// never drop a player.
function poolKeys(ctx: Ctx) {
  return ctx == null
    ? { items: 'player_pool', list: 'time_measure_names' }
    : { items: `player_pool:${ctx}`, list: `g:${ctx}:time_measure_names` }
}

export async function loadPlayerPool(ctx: Ctx = null): Promise<string[]> {
  const out = new Set<string>()
  const { items, list } = poolKeys(ctx)
  try {
    const { data, error } = await ctxFilter(
      supabase.from('app_config').select('key,value,group_id').in('key', [items, list]), ctx)
    if (!error && data) for (const row of data as { key: string; value: unknown }[]) {
      if (row.key === items) {
        const arr = (row.value && typeof row.value === 'object' && Array.isArray((row.value as { items?: unknown }).items))
          ? (row.value as { items: unknown[] }).items : []
        for (const s of arr) if (typeof s === 'string' && s.trim()) out.add(s.trim())
      } else if (Array.isArray(row.value)) {
        for (const s of row.value) if (typeof s === 'string' && s.trim()) out.add(s.trim())
      }
    }
  } catch { /* best effort */ }
  // In a group, the members' per-group display names are people of the group too.
  if (ctx != null) {
    try { for (const m of await groupMembers(ctx)) if (m.name?.trim()) out.add(m.name.trim()) } catch { /* ignore */ }
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export async function addPlayersToPool(ctx: Ctx, names: string[]): Promise<string[]> {
  const add = names.map((n) => n.trim()).filter(Boolean)
  const current = await loadPlayerPool(ctx)
  if (!add.length) return current
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) return current
  const merged = [...new Set([...current, ...add])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  if (merged.length === current.length) return current   // nothing new
  const { items, list } = poolKeys(ctx)
  await supabase.from('app_config').upsert([
    { owner_id: uid, group_id: ctx, key: items, value: { items: merged } },
    { owner_id: uid, group_id: ctx, key: list, value: merged }
  ], { onConflict: 'owner_id,key' })
  return merged
}

// Training "categories" (the app calls them modes) are per training type, synced via
// app_config like match_categories: time_measure_modes (Zeitmessung), timed_outcome_modes
// (Zeit & Erfolg), outcome_modes (Erfolgsquote) — group-prefixed for a group context.
const TRAINING_MODE_KEY: Record<string, string> = {
  measure: 'time_measure_modes',
  measure_success: 'timed_outcome_modes',
  outcome: 'outcome_modes'
}

export async function loadTrainingModes(ctx: Ctx, kind: string): Promise<string[]> {
  const base = TRAINING_MODE_KEY[kind]
  if (!base) return []
  try {
    const key = `${ctx ? `g:${ctx}:` : ''}${base}`
    const { data, error } = await ctxFilter(
      supabase.from('app_config').select('value').eq('key', key), ctx)
    if (error || !data) return []
    const out = new Set<string>()
    for (const row of data as { value: unknown }[]) {
      if (Array.isArray(row.value)) for (const s of row.value) if (typeof s === 'string' && s.trim()) out.add(s)
    }
    return [...out]
  } catch { return [] }
}

export async function saveTrainingModes(ctx: Ctx, kind: string, list: string[]): Promise<void> {
  const base = TRAINING_MODE_KEY[kind]
  if (!base) return
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const key = `${ctx ? `g:${ctx}:` : ''}${base}`
  const { error } = await supabase.from('app_config')
    .upsert({ owner_id: uid, group_id: ctx, key, value: list }, { onConflict: 'owner_id,key' })
  if (error) throw error
}

// Per-mode target time window (seconds), the app's TimeWindow. Synced byte-compat
// with CloudConfig's MAP_KEYS: a JSON object { "<mode>": { fromSeconds, toSeconds } }.
// Only the two timed kinds have windows: Zeitmessung → time_measure_windows,
// Zeit & Erfolg → timed_outcome_windows. (Erfolgsquote has a % target instead,
// which the app keeps device-local — see trainingprefs.ts.)
export type TimeWindow = { fromSeconds?: number | null; toSeconds?: number | null }
const TRAINING_WINDOW_KEY: Record<string, string> = {
  measure: 'time_measure_windows',
  measure_success: 'timed_outcome_windows'
}

export async function loadTrainingWindows(ctx: Ctx, kind: string): Promise<Record<string, TimeWindow>> {
  const base = TRAINING_WINDOW_KEY[kind]
  if (!base) return {}
  try {
    const key = `${ctx ? `g:${ctx}:` : ''}${base}`
    const { data, error } = await ctxFilter(
      supabase.from('app_config').select('value').eq('key', key), ctx)
    if (error || !data) return {}
    const out: Record<string, TimeWindow> = {}
    for (const row of data as { value: unknown }[]) {
      const v = row.value
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [m, w] of Object.entries(v as Record<string, unknown>)) {
          if (w && typeof w === 'object') {
            const ww = w as Record<string, unknown>
            out[m] = {
              fromSeconds: typeof ww.fromSeconds === 'number' ? ww.fromSeconds : null,
              toSeconds: typeof ww.toSeconds === 'number' ? ww.toSeconds : null
            }
          }
        }
      }
    }
    return out
  } catch { return {} }
}

// Merge one mode's window into the synced map (local wins on a key clash, like the
// app). Passing an all-null window clears that mode's entry.
export async function saveTrainingWindow(ctx: Ctx, kind: string, mode: string, win: TimeWindow): Promise<void> {
  const base = TRAINING_WINDOW_KEY[kind]
  if (!base || !mode.trim()) return
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const current = await loadTrainingWindows(ctx, kind)
  if (win.fromSeconds == null && win.toSeconds == null) delete current[mode]
  else current[mode] = { fromSeconds: win.fromSeconds ?? null, toSeconds: win.toSeconds ?? null }
  const key = `${ctx ? `g:${ctx}:` : ''}${base}`
  const { error } = await supabase.from('app_config')
    .upsert({ owner_id: uid, group_id: ctx, key, value: current }, { onConflict: 'owner_id,key' })
  if (error) throw error
}

// My per-group display name (group_names: one row per group+user), or null if unset.
// Best-effort — never throws (the UI just shows "festlegen" if it can't read).
export async function myGroupName(groupId: string): Promise<string | null> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const uid = sess.session?.user.id
    if (!uid) return null
    const { data, error } = await supabase
      .from('group_names').select('name').eq('group_id', groupId).eq('user_id', uid).maybeSingle()
    if (error || !data) return null
    return (data as { name: string | null }).name ?? null
  } catch { return null }
}

// Set my per-group display name (set_group_name RPC). Returns whether the name
// collides with another member's (a soft warning, like the app). Throws on failure.
export async function setGroupDisplayName(groupId: string, name: string): Promise<{ duplicate: boolean }> {
  const { data, error } = await supabase.rpc('set_group_name', { g: groupId, p_name: name.trim() })
  if (error) throw error
  return { duplicate: data === true }
}

// Leave a training group (delete my membership). Owners cannot leave (RLS / the
// app guards that) — they delete the group instead. Throws on failure.
export async function leaveGroup(groupId: string): Promise<void> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user.id
  if (!uid) throw new Error('not_authenticated')
  const { error } = await supabase.from('memberships').delete().eq('group_id', groupId).eq('user_id', uid)
  if (error) throw error
}

// ---- Group administration (owner/moderator), mirroring GroupManageFragment ----
export type Member = { userId: string; email: string | null; name: string | null; role: string; access: string }
export type GroupSettings = {
  id: string; name: string; ownerId: string | null; maxMembers: number
  joinCode: string | null; joinEnabled: boolean; joinDefaultAccess: string
  retentionDays: number | null; retentionTz: string | null
}

// Roster via the group_members RPC (emails only for managers; backend-enforced).
export async function groupMembers(groupId: string): Promise<Member[]> {
  const { data, error } = await supabase.rpc('group_members', { g: groupId })
  if (error) throw error
  return (data ?? []).map((m: { user_id: string; email: string | null; name: string | null; role: string | null; access: string | null }) =>
    ({ userId: m.user_id, email: m.email ?? null, name: m.name ?? null, role: m.role ?? 'member', access: m.access ?? 'write' }))
}

// Group settings row (join code etc. only readable by managers via RLS → null fields).
export async function groupSettings(groupId: string): Promise<GroupSettings | null> {
  const { data, error } = await supabase.from('groups')
    .select('id,name,owner_id,max_members,join_code,join_enabled,join_default_access,retention_days,retention_tz')
    .eq('id', groupId).maybeSingle()
  if (error || !data) return null
  const g = data as Record<string, unknown>
  return {
    id: g.id as string, name: (g.name as string) ?? '—', ownerId: (g.owner_id as string) ?? null,
    maxMembers: (g.max_members as number) ?? 20, joinCode: (g.join_code as string) ?? null,
    joinEnabled: (g.join_enabled as boolean) ?? true, joinDefaultAccess: (g.join_default_access as string) ?? 'write',
    retentionDays: (g.retention_days as number) ?? null, retentionTz: (g.retention_tz as string) ?? null
  }
}

export async function setMemberRole(groupId: string, target: string, role: string): Promise<void> {
  const { error } = await supabase.rpc('set_member_role', { g: groupId, target, new_role: role }); if (error) throw error
}
export async function setMemberAccess(groupId: string, target: string, access: string): Promise<void> {
  const { error } = await supabase.rpc('set_member_access', { g: groupId, target, new_access: access }); if (error) throw error
}
export async function removeMember(groupId: string, target: string): Promise<void> {
  const { error } = await supabase.rpc('remove_member', { g: groupId, target }); if (error) throw error
}
export async function regenerateJoinCode(groupId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('regenerate_join_code', { g: groupId }); if (error) throw error
  return (data as string) ?? null
}
export async function configureJoin(groupId: string, enabled: boolean, unlimited: boolean, defaultAccess: string): Promise<void> {
  const { error } = await supabase.rpc('configure_join',
    { g: groupId, p_enabled: enabled, p_unlimited: unlimited, p_default_access: defaultAccess }); if (error) throw error
}
export async function setResultRetention(groupId: string, days: number | null, tz: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_result_retention', { g: groupId, p_days: days, p_tz: tz }); if (error) throw error
}
export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_group', { g: groupId }); if (error) throw error
}

// Optional result retention of a group (null = off / not set). Best-effort: if the
// backend doesn't have the retention columns yet, this resolves to null (the notice
// simply stays hidden) so the web app never breaks ahead of the migration.
export type Retention = { days: number; tz: string }
export async function loadGroupRetention(groupId: string): Promise<Retention | null> {
  try {
    const { data, error } = await supabase
      .from('groups').select('retention_days,retention_tz').eq('id', groupId).maybeSingle()
    if (error || !data) return null
    const r = data as { retention_days: number | null; retention_tz: string | null }
    if (r.retention_days == null) return null
    return { days: r.retention_days, tz: r.retention_tz ?? 'UTC' }
  } catch {
    return null
  }
}

// A data context: null = "Dein Konto" (personal, group_id null), else a group id.
export type Ctx = string | null
const ctxFilter = (q: any, ctx: Ctx) => (ctx == null ? q.is('group_id', null) : q.eq('group_id', ctx))

export type MatchItem = {
  homeName: string
  awayName: string
  setsHome: number
  setsAway: number
  category: string | null
  at: number // epoch ms
  state: unknown
  running: boolean
}

// 'home' | 'away' | 'tie' — who won by sets. Pure (unit-tested).
export function winnerSide(setsHome: number, setsAway: number): 'home' | 'away' | 'tie' {
  if (setsHome > setsAway) return 'home'
  if (setsAway > setsHome) return 'away'
  return 'tie'
}

export type TrainingItem = {
  kind: 'measure' | 'measure_success' | 'outcome'
  mode: string
  name: string
  at: number
  elapsedMs?: number
  limitSeconds?: number
  success?: boolean
}

// Elapsed milliseconds as a signed "x.xs" string (matches the app's display).
export function formatElapsed(ms: number): string {
  const s = ms / 1000
  return `${s >= 0 ? '' : '-'}${Math.abs(s).toFixed(1)}s`
}

// dayKey "yyyyMMdd" (local) for grouping a list of matches by day.
export function dayKey(at: number): string {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

// The signed-in user's PERSONAL matches (group_id null), newest first. RLS limits
// rows to the user. A later step adds group context switching.
export async function loadMatches(ctx: Ctx = null): Promise<MatchItem[]> {
  const { data, error } = await ctxFilter(
    supabase
      .from('matches')
      .select('home_name,away_name,sets_home,sets_away,category,state,created_at,deleted_at,group_id,running'),
    ctx)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: {
    home_name: string | null; away_name: string | null
    sets_home: number | null; sets_away: number | null
    category: string | null; state: unknown; created_at: string | null; running: boolean | null
  }) => ({
    homeName: r.home_name ?? '–',
    awayName: r.away_name ?? '–',
    setsHome: r.sets_home ?? 0,
    setsAway: r.sets_away ?? 0,
    category: r.category,
    at: r.created_at ? Date.parse(r.created_at) : 0,
    state: r.state,
    running: r.running ?? false
  }))
}

// The signed-in user's PERSONAL training entries (group_id null), newest first.
// kind: "measure" (Zeitmessung), "measure_success" (Zeit & Erfolg), "outcome"
// (Erfolgsquote). The lean payload lives in data jsonb (name/ts/elapsedMs/limit/
// success), mirroring CloudTrainingSync.
export async function loadTraining(ctx: Ctx = null): Promise<TrainingItem[]> {
  const { data, error } = await ctxFilter(
    supabase
      .from('training_entries')
      .select('kind,mode,data,occurred_at,deleted_at,group_id'),
    ctx)
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
  if (error) throw error
  type Row = {
    kind: string; mode: string | null; deleted_at: string | null
    data: { name?: string; ts?: number; elapsedMs?: number; limit?: number; success?: boolean } | null
  }
  return (data ?? [])
    .filter((r: Row) => r.kind === 'measure' || r.kind === 'measure_success' || r.kind === 'outcome')
    .map((r: Row) => ({
      kind: r.kind as TrainingItem['kind'],
      mode: r.mode ?? '',
      name: r.data?.name ?? '',
      at: r.data?.ts ?? 0,
      elapsedMs: r.data?.elapsedMs,
      limitSeconds: r.data?.limit,
      success: r.data?.success
    }))
}
