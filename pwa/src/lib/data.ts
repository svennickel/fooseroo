import { supabase } from './supabase'

export type MatchItem = {
  homeName: string
  awayName: string
  setsHome: number
  setsAway: number
  category: string | null
  at: number // epoch ms
  state: unknown
}

// 'home' | 'away' | 'tie' — who won by sets. Pure (unit-tested).
export function winnerSide(setsHome: number, setsAway: number): 'home' | 'away' | 'tie' {
  if (setsHome > setsAway) return 'home'
  if (setsAway > setsHome) return 'away'
  return 'tie'
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
    .select('home_name,away_name,sets_home,sets_away,category,state,created_at,deleted_at,group_id')
    .is('group_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((r: {
    home_name: string | null; away_name: string | null
    sets_home: number | null; sets_away: number | null
    category: string | null; state: unknown; created_at: string | null
  }) => ({
    homeName: r.home_name ?? '–',
    awayName: r.away_name ?? '–',
    setsHome: r.sets_home ?? 0,
    setsAway: r.sets_away ?? 0,
    category: r.category,
    at: r.created_at ? Date.parse(r.created_at) : 0,
    state: r.state
  }))
}
