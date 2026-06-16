// Byte-faithful TypeScript port of the app's MatchScore (MatchScore.kt). The
// serialized shape (JSON.stringify of ScoreState) is identical to the Gson output
// the app stores in matches.state and broadcasts live, so the web can edit/create
// matches that sync seamlessly with the native app (parseMatchState reads it back).
//
// Enums are their Kotlin name strings; field names match exactly. All mutators
// return a NEW ScoreState (immutable) so Svelte reactivity sees the change.

export type Team = 'NONE' | 'TEAM_A' | 'TEAM_B'
export type ActionType = 'SERVE' | 'GOAL' | 'TIMEOUT' | 'RESET' | 'GAME_FINISHED'
export type ResetState = 'NONE' | 'RESET' | 'RESET_WARNING' | 'RESET_VIOLATION'
export type MatchAction = { time: string; team: Team; type: ActionType }
export type ScoreState = {
  matchActions: MatchAction[]
  serve: Team
  goalsA: number
  goalsB: number
  timeoutsA: number
  timeoutsB: number
  resetStateA: ResetState
  resetStateB: ResetState
  games: string
}

export function emptyScore(): ScoreState {
  return { matchActions: [], serve: 'NONE', goalsA: 0, goalsB: 0, timeoutsA: 0, timeoutsB: 0,
    resetStateA: 'NONE', resetStateB: 'NONE', games: '' }
}

function resetStateNext(s: ResetState): ResetState {
  switch (s) {
    case 'NONE': return 'RESET'
    case 'RESET': return 'RESET_WARNING'
    case 'RESET_WARNING': return 'RESET_VIOLATION'
    case 'RESET_VIOLATION': return 'RESET_WARNING'
  }
}

// Mutates the derived counters of `st` for one action (mirrors evaluateAction).
function evaluate(st: ScoreState, a: MatchAction): void {
  switch (a.type) {
    case 'SERVE': st.serve = a.team; break
    case 'GOAL':
      if (a.team === 'TEAM_A') { st.goalsA++; st.serve = 'TEAM_B' }
      else { st.goalsB++; st.serve = 'TEAM_A' }
      if (st.resetStateA !== 'NONE') st.resetStateA = 'RESET'
      if (st.resetStateB !== 'NONE') st.resetStateB = 'RESET'
      break
    case 'TIMEOUT':
      if (a.team === 'TEAM_A') st.timeoutsA++; else st.timeoutsB++
      break
    case 'RESET':
      if (a.team === 'TEAM_A') st.resetStateA = resetStateNext(st.resetStateA)
      else st.resetStateB = resetStateNext(st.resetStateB)
      break
    case 'GAME_FINISHED':
      st.serve = st.goalsA > st.goalsB ? 'TEAM_B' : st.goalsA < st.goalsB ? 'TEAM_A' : 'NONE'
      if (st.games.length !== 0) st.games += ' '
      st.games += `${st.goalsA}:${st.goalsB}`
      st.goalsA = 0; st.goalsB = 0; st.timeoutsA = 0; st.timeoutsB = 0
      st.resetStateA = 'NONE'; st.resetStateB = 'NONE'
      break
  }
}

// Recompute all derived counters from the action list (mirrors reevaluateActions).
function reevaluate(actions: MatchAction[]): ScoreState {
  const st = emptyScore()
  st.matchActions = actions
  for (const a of actions) evaluate(st, a)
  return st
}

// Mirrors isActionAllowed.
export function isAllowed(st: ScoreState, team: Team, type: ActionType): boolean {
  if (type === 'SERVE' && (st.goalsA > 0 || st.goalsB > 0)) return false
  if (type === 'GOAL' && ((team === 'TEAM_A' && st.goalsA >= 99) || (team === 'TEAM_B' && st.goalsB >= 99))) return false
  if (type === 'TIMEOUT' && ((team === 'TEAM_A' && st.timeoutsA >= 2) || (team === 'TEAM_B' && st.timeoutsB >= 2))) return false
  if (type === 'GAME_FINISHED' && st.goalsA === 0 && st.goalsB === 0) return false
  return true
}

// action(): append + evaluate. Returns the new state, or null if not allowed.
export function applyAction(st: ScoreState, team: Team, type: ActionType): ScoreState | null {
  if (!isAllowed(st, team, type)) return null
  const a: MatchAction = { time: new Date().toISOString(), team, type }
  return reevaluate([...st.matchActions, a])
}

export function undo(st: ScoreState): ScoreState {
  if (st.matchActions.length === 0) return st
  return reevaluate(st.matchActions.slice(0, -1))
}

export function clearActions(): ScoreState {
  return reevaluate([])
}

// Retroactive history replacement (switch/remove/insert), like replaceActions.
export function replaceActions(actions: MatchAction[]): ScoreState {
  return reevaluate(actions)
}

// Swap sides: flip every action's team and recompute (mirrors swapSidesData).
export function swapSides(st: ScoreState): ScoreState {
  const swapped = st.matchActions.map((a) => ({
    ...a, team: a.team === 'TEAM_A' ? 'TEAM_B' as Team : a.team === 'TEAM_B' ? 'TEAM_A' as Team : a.team
  }))
  return reevaluate(swapped)
}

// Sets won per side, from the completed games string ("5:3 5:3 4:5").
export function setsWonFromGames(games: string): { a: number; b: number } {
  let a = 0, b = 0
  for (const g of games.trim().split(/\s+/).filter(Boolean)) {
    const [x, y] = g.split(':').map((n) => parseInt(n, 10))
    if (Number.isFinite(x) && Number.isFinite(y)) { if (x > y) a++; else if (y > x) b++ }
  }
  return { a, b }
}
