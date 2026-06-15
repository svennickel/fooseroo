import { describe, it, expect } from 'vitest'
import { parseMatchState, setsWon } from '../src/lib/match'

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
    expect(v.goals.at(-1)).toEqual({ team: 'B', a: 0, b: 1, set: 1 })
    expect(v.goals.length).toBe(4)
  })

  it('a finished match has no running set when the last set was filed', () => {
    const finished = { ...state, matchActions: [...state.matchActions, { type: 'GOAL', team: 'TEAM_B' }, { type: 'GAME_FINISHED', team: 'TEAM_B' }] }
    const v = parseMatchState(finished, false)
    expect(v.sets.length).toBe(2)
    expect(v.current).toBeNull()
    expect(setsWon(v)).toEqual({ a: 1, b: 1 })
  })
})
