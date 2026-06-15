import { describe, it, expect } from 'vitest'
import { parseMatchState, setsWon, progressRows, neededUsable, rowXs, PROG } from '../src/lib/match'

const state = {
  matchActions: [
    { type: 'SERVE', team: 'TEAM_A' },
    { type: 'GOAL', team: 'TEAM_A' },
    { type: 'GOAL', team: 'TEAM_A' },
    { type: 'GOAL', team: 'TEAM_B' },
    { type: 'GAME_FINISHED', team: 'TEAM_A' }, // set 1: 2:1
    { type: 'GOAL', team: 'TEAM_B' },
    { type: 'TIMEOUT', team: 'TEAM_A' }
  ],
  serve: 'TEAM_A',
  timeoutsA: 1,
  timeoutsB: 0
}

describe('parseMatchState', () => {
  it('extracts completed sets, the running set and progression', () => {
    const v = parseMatchState(state, true)
    expect(v.sets).toEqual([{ a: 2, b: 1 }])
    expect(v.current).toEqual({ a: 0, b: 1 })
    expect(v.timeoutsA).toBe(1)
    expect(v.serve).toBe('A')
    expect(v.goals.at(-1)).toEqual({ team: 'B', a: 0, b: 1, label: 1, t: null, set: 1 })
    expect(v.goals.length).toBe(4)
  })

  it('labels each goal with the scoring team running count in the set', () => {
    const v = parseMatchState(state, true)
    // set 0: A(1), A(2), B(1)
    expect(v.goals.slice(0, 3).map((g) => g.label)).toEqual([1, 2, 1])
  })

  it('parses ISO goal times into epoch ms', () => {
    const withTime = { ...state, matchActions: [{ type: 'GOAL', team: 'TEAM_A', time: '2026-06-15T10:00:00Z' }] }
    const v = parseMatchState(withTime, true)
    expect(v.goals[0].t).toBe(Date.parse('2026-06-15T10:00:00Z'))
  })

  it('a finished match has no running set when the last set was filed', () => {
    const finished = { ...state, matchActions: [...state.matchActions, { type: 'GOAL', team: 'TEAM_B' }, { type: 'GAME_FINISHED', team: 'TEAM_B' }] }
    const v = parseMatchState(finished, false)
    expect(v.sets.length).toBe(2)
    expect(v.current).toBeNull()
    expect(setsWon(v)).toEqual({ a: 1, b: 1 })
  })
})

describe('progressRows', () => {
  it('groups goals per set and marks the running set', () => {
    const v = parseMatchState(state, true)
    const { rows, runningSetIndex } = progressRows(v, true)
    expect(rows.length).toBe(2)
    expect(runningSetIndex).toBe(1)
    expect(rows[0]).toMatchObject({ goalsA: 2, goalsB: 1, live: false })
    expect(rows[0].goals.length).toBe(3)
    expect(rows[1]).toMatchObject({ goalsA: 0, goalsB: 1, live: true })
  })

  it('a finished match has no running set', () => {
    const finished = { ...state, matchActions: [...state.matchActions, { type: 'GOAL', team: 'TEAM_B' }, { type: 'GAME_FINISHED', team: 'TEAM_B' }] }
    const v = parseMatchState(finished, false)
    const { rows, runningSetIndex } = progressRows(v, false)
    expect(runningSetIndex).toBe(-1)
    expect(rows.length).toBe(2)
    expect(rows.every((r) => !r.live)).toBe(true)
  })
})

describe('rowXs / neededUsable', () => {
  const v = parseMatchState(state, true)
  const { rows, runningSetIndex } = progressRows(v, true)

  it('keeps same-lane boxes at least a box+gap apart and orders newest left', () => {
    const usable = neededUsable(rows, runningSetIndex)
    const xs = rowXs(rows[0], 0, runningSetIndex, usable) // A, A, B (chronological)
    // newest goal (last index) sits left of the oldest (first index)
    expect(xs[xs.length - 1]).toBeLessThan(xs[0])
    // the two team-A boxes (indices 0,1) clear a full box + same-lane gap
    expect(Math.abs(xs[0] - xs[1])).toBeGreaterThanOrEqual(PROG.boxW + PROG.goalGap - 0.001)
  })

  it('reserves the Kuller slot for the running set (first box not at the very edge)', () => {
    const usable = neededUsable(rows, runningSetIndex)
    const xs = rowXs(rows[1], 1, runningSetIndex, usable) // single B goal in running set
    expect(xs[0]).toBeGreaterThanOrEqual(PROG.boxW / 2)
  })
})
