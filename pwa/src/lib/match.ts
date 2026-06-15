// Parse a match's `state` jsonb (Gson-serialized MatchScore) into a view model:
// completed sets, the in-progress set, serve/timeouts, and the goal-by-goal
// progression. Mirrors MatchScore.evaluateAction (GOAL flips serve & increments;
// GAME_FINISHED files "a:b" into games and resets the set).

export type Side = 'A' | 'B'

export type GoalEvent = { team: Side; a: number; b: number; set: number }

export type MatchView = {
  sets: { a: number; b: number }[] // completed sets
  current: { a: number; b: number } | null // in-progress set
  serve: Side | null
  timeoutsA: number
  timeoutsB: number
  goals: GoalEvent[] // running goal progression across all sets
}

type RawAction = { team?: string; type?: string }
type RawState = {
  matchActions?: RawAction[]
  serve?: string
  goalsA?: number
  goalsB?: number
  timeoutsA?: number
  timeoutsB?: number
} | null | undefined

const side = (t: string | undefined): Side | null =>
  t === 'TEAM_A' ? 'A' : t === 'TEAM_B' ? 'B' : null

export function parseMatchState(stateRaw: unknown, running: boolean): MatchView {
  const state = (stateRaw ?? null) as RawState
  const actions: RawAction[] = Array.isArray(state?.matchActions) ? state!.matchActions! : []
  const sets: { a: number; b: number }[] = []
  const goals: GoalEvent[] = []
  let a = 0, b = 0, set = 0
  for (const act of actions) {
    const team = side(act?.team)
    if (act?.type === 'GOAL') {
      if (team === 'A') a++
      else if (team === 'B') b++
      if (team) goals.push({ team, a, b, set })
    } else if (act?.type === 'GAME_FINISHED') {
      sets.push({ a, b }); a = 0; b = 0; set++
    }
  }
  const current = running || a > 0 || b > 0 ? { a, b } : null
  return {
    sets,
    current,
    serve: side(state?.serve),
    timeoutsA: state?.timeoutsA ?? 0,
    timeoutsB: state?.timeoutsB ?? 0,
    goals
  }
}

// Sets won per side (from completed sets) — to cross-check / display.
export function setsWon(view: MatchView): { a: number; b: number } {
  let a = 0, b = 0
  for (const s of view.sets) { if (s.a > s.b) a++; else if (s.b > s.a) b++ }
  return { a, b }
}
