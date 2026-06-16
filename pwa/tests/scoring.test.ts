import { describe, it, expect } from 'vitest'
import {
  emptyScore, applyAction, isAllowed, undo, swapSides, setsWonFromGames, type ScoreState,
} from '../src/lib/scoring'

// The scoring engine must mirror the app's MatchScore byte-for-byte (the serialized
// state is what syncs to/from the native app), so these guard the exact rules.

const seq = (...steps: [Parameters<typeof applyAction>[1], Parameters<typeof applyAction>[2]][]): ScoreState => {
  let s = emptyScore()
  for (const [team, type] of steps) { const n = applyAction(s, team, type); if (n) s = n }
  return s
}

describe('scoring engine', () => {
  it('a goal increments the scorer and flips serve to the other team', () => {
    const s = seq(['TEAM_A', 'GOAL'])
    expect(s.goalsA).toBe(1)
    expect(s.goalsB).toBe(0)
    expect(s.serve).toBe('TEAM_B')
    const s2 = seq(['TEAM_A', 'GOAL'], ['TEAM_B', 'GOAL'])
    expect(s2.serve).toBe('TEAM_A')
  })

  it('SERVE is only allowed before any goal', () => {
    expect(isAllowed(emptyScore(), 'TEAM_A', 'SERVE')).toBe(true)
    const afterGoal = seq(['TEAM_A', 'GOAL'])
    expect(isAllowed(afterGoal, 'TEAM_B', 'SERVE')).toBe(false)
  })

  it('GAME_FINISHED needs a goal, files "a:b" into games and resets the set', () => {
    expect(isAllowed(emptyScore(), 'NONE', 'GAME_FINISHED')).toBe(false)
    const s = seq(['TEAM_A', 'GOAL'], ['TEAM_A', 'GOAL'], ['TEAM_B', 'GOAL'], ['NONE', 'GAME_FINISHED'])
    expect(s.games).toBe('2:1')
    expect(s.goalsA).toBe(0)
    expect(s.goalsB).toBe(0)
    // serve goes to the loser of the set (A won 2:1 → B serves next)
    expect(s.serve).toBe('TEAM_B')
    const s2 = seq(['TEAM_A', 'GOAL'], ['NONE', 'GAME_FINISHED'], ['TEAM_B', 'GOAL'], ['TEAM_B', 'GOAL'], ['NONE', 'GAME_FINISHED'])
    expect(s2.games).toBe('1:0 0:2')
  })

  it('timeouts cap at 2 per team and goals at 99', () => {
    const t = seq(['TEAM_A', 'TIMEOUT'], ['TEAM_A', 'TIMEOUT'])
    expect(t.timeoutsA).toBe(2)
    expect(isAllowed(t, 'TEAM_A', 'TIMEOUT')).toBe(false)
    const s = emptyScore(); s.goalsA = 99
    expect(isAllowed(s, 'TEAM_A', 'GOAL')).toBe(false)
  })

  it('undo reverts the last action', () => {
    const s = seq(['TEAM_A', 'GOAL'], ['TEAM_B', 'GOAL'])
    const u = undo(s)
    expect(u.goalsA).toBe(1)
    expect(u.goalsB).toBe(0)
    expect(u.matchActions.length).toBe(1)
  })

  it('swapSides flips every action team and recomputes', () => {
    const s = seq(['TEAM_A', 'GOAL'], ['TEAM_A', 'GOAL'], ['TEAM_B', 'GOAL'])
    const w = swapSides(s)
    expect(w.goalsA).toBe(1)
    expect(w.goalsB).toBe(2)
  })

  it('setsWonFromGames counts won sets per side', () => {
    expect(setsWonFromGames('5:3 4:5 5:2')).toEqual({ a: 2, b: 1 })
    expect(setsWonFromGames('')).toEqual({ a: 0, b: 0 })
  })

  it('serializes to the exact MatchScore field shape', () => {
    const s = seq(['TEAM_A', 'GOAL'])
    const obj = JSON.parse(JSON.stringify(s))
    expect(Object.keys(obj).sort()).toEqual(
      ['games', 'goalsA', 'goalsB', 'matchActions', 'resetStateA', 'resetStateB', 'serve', 'timeoutsA', 'timeoutsB'])
    expect(Object.keys(obj.matchActions[0]).sort()).toEqual(['team', 'time', 'type'])
    expect(obj.matchActions[0].type).toBe('GOAL')
    expect(obj.matchActions[0].team).toBe('TEAM_A')
  })
})
