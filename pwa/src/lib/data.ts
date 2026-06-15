import { supabase } from './supabase'

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
export async function loadPersonalMatches(): Promise<MatchItem[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('home_name,away_name,sets_home,sets_away,category,state,created_at,deleted_at,group_id,running')
    .is('group_id', null)
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
export async function loadPersonalTraining(): Promise<TrainingItem[]> {
  const { data, error } = await supabase
    .from('training_entries')
    .select('kind,mode,data,occurred_at,deleted_at,group_id')
    .is('group_id', null)
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
