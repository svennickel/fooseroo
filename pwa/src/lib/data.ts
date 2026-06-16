import { supabase } from './supabase'

export type Group = { id: string; name: string; ownerId: string | null }

// The signed-in user's training groups (RLS limits to memberships). ownerId lets the
// UI hide "leave" for the owner (who deletes the group instead, like the app).
export async function loadGroups(): Promise<Group[]> {
  const { data, error } = await supabase.from('groups').select('id,name,owner_id').order('name')
  if (error) throw error
  return (data ?? []).map((g: { id: string; name: string | null; owner_id: string | null }) =>
    ({ id: g.id, name: g.name ?? '—', ownerId: g.owner_id ?? null }))
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
