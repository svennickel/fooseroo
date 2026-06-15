// Parse a match's `state` jsonb (Gson-serialized MatchScore) into a view model:
// completed sets, the in-progress set, serve/timeouts, and the goal-by-goal
// progression. Mirrors MatchScore.evaluateAction (GOAL flips serve & increments;
// GAME_FINISHED files "a:b" into games and resets the set).

export type Side = 'A' | 'B'

// A single goal in the progression. a/b are the cumulative set score AFTER it,
// `label` is the scoring team's running count within the set (the number drawn in
// the counter box), `t` its epoch-ms timestamp (null if absent), `set` its set idx.
export type GoalEvent = { team: Side; a: number; b: number; label: number; t: number | null; set: number }

export type MatchView = {
  sets: { a: number; b: number }[] // completed sets
  current: { a: number; b: number } | null // in-progress set
  serve: Side | null
  timeoutsA: number
  timeoutsB: number
  goals: GoalEvent[] // running goal progression across all sets
}

type RawAction = { team?: string; type?: string; time?: string }
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

const parseTime = (s: string | undefined): number | null => {
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

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
      if (team) goals.push({ team, a, b, label: team === 'A' ? a : b, t: parseTime(act?.time), set })
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

// ── Progression layout (port of MatchProgressView) ──────────────────────────
// One row per set, the most recent goal next to the result on the LEFT and the
// oldest at the right; team A's counter boxes ride slightly above the axis, team
// B's slightly below, so the counters visibly leapfrog. All dimensions are the
// app's dp values used 1:1 as CSS px so it reads like the Android view.

export type ProgGoal = { team: Side; label: number; t: number | null }
export type ProgRow = { goalsA: number; goalsB: number; goals: ProgGoal[]; live: boolean }

export const PROG = {
  rowHeight: 76, rowGap: 10, rowInset: 10, labelWidth: 92,
  boxW: 24, boxH: 22, boxRadius: 6, goalGap: 5, crossGoalGap: 24 * 0.6,
  laneOffset: 15, kullerRadius: 8, scoreInset: 20
}
const MIN_GAP = 60_000
const MAX_GAP = 15 * 60_000

// Group the flat goal list into per-set rows plus the running set index.
export function progressRows(view: MatchView, running: boolean): { rows: ProgRow[]; runningSetIndex: number } {
  const bySet = new Map<number, ProgGoal[]>()
  for (const g of view.goals) {
    const arr = bySet.get(g.set) ?? []
    arr.push({ team: g.team, label: g.label, t: g.t })
    bySet.set(g.set, arr)
  }
  const rows: ProgRow[] = view.sets.map((s, i) => ({
    goalsA: s.a, goalsB: s.b, goals: bySet.get(i) ?? [], live: false
  }))
  const runningSetIndex = running && view.current ? view.sets.length : -1
  if (view.current) {
    rows.push({
      goalsA: view.current.a, goalsB: view.current.b,
      goals: bySet.get(view.sets.length) ?? [], live: runningSetIndex >= 0
    })
  }
  return { rows, runningSetIndex }
}

// The shared usable axis width: wide enough that the densest set keeps its
// minimum same-lane and cross-team gaps. Mirrors MatchProgressView.neededUsable.
export function neededUsable(rows: ProgRow[], runningSetIndex: number): number {
  const { boxW, goalGap, crossGoalGap } = PROG
  let maxExtent = 0
  rows.forEach((row, index) => {
    const seed = index === runningSetIndex ? 0 : -Infinity
    let lastAny = seed, lastA = seed, lastB = seed, extent = 0
    for (let i = row.goals.length - 1; i >= 0; i--) {
      const teamA = row.goals[i].team === 'A'
      const required = Math.max(lastAny + crossGoalGap, (teamA ? lastA : lastB) + boxW + goalGap)
      const d = Math.max(required, 0)
      extent = Math.max(extent, d)
      lastAny = d
      if (teamA) lastA = d; else lastB = d
    }
    maxExtent = Math.max(maxExtent, extent)
  })
  return maxExtent
}

// Axis-relative X (centre) of every goal box in one set: time-normalized over the
// shared usable width, then pushed right to keep the gaps. Mirrors computeRowXs.
export function rowXs(row: ProgRow, index: number, runningSetIndex: number, usable: number): number[] {
  const { boxW, goalGap, crossGoalGap } = PROG
  const n = row.goals.length
  const xs = new Array<number>(n).fill(0)
  if (n > 0) {
    const adjusted = new Array<number>(n).fill(0)
    for (let i = 1; i < n; i++) {
      const cur = row.goals[i].t, prev = row.goals[i - 1].t
      const gap = (cur != null && prev != null)
        ? Math.min(Math.max(cur - prev, MIN_GAP), MAX_GAP)
        : MIN_GAP
      adjusted[i] = adjusted[i - 1] + gap
    }
    const span = adjusted[n - 1]
    for (let i = 0; i < n; i++) {
      const ratio = span > 0 ? adjusted[i] / span : 1
      xs[i] = boxW / 2 + (1 - ratio) * usable
    }
  }
  const anchor = boxW / 2
  const seed = index === runningSetIndex ? anchor : -Infinity
  let lastAny = seed, lastA = seed, lastB = seed
  for (let i = n - 1; i >= 0; i--) {
    const teamA = row.goals[i].team === 'A'
    const required = Math.max(lastAny + crossGoalGap, (teamA ? lastA : lastB) + boxW + goalGap)
    if (xs[i] < required) xs[i] = required
    lastAny = xs[i]
    if (teamA) lastA = xs[i]; else lastB = xs[i]
  }
  return xs
}
