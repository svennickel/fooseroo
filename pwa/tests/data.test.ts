import { describe, it, expect } from 'vitest'
import { winnerSide, dayKey, formatElapsed } from '../src/lib/data'

describe('winnerSide', () => {
  it('picks the higher set count', () => {
    expect(winnerSide(3, 1)).toBe('home')
    expect(winnerSide(0, 2)).toBe('away')
    expect(winnerSide(2, 2)).toBe('tie')
  })
})

describe('formatElapsed', () => {
  it('formats to one decimal with a unit', () => {
    expect(formatElapsed(5000)).toBe('5.0s')
    expect(formatElapsed(12340)).toBe('12.3s')
    expect(formatElapsed(-1500)).toBe('-1.5s')
  })
})

describe('dayKey', () => {
  it('formats local date as yyyyMMdd', () => {
    const at = new Date(2026, 5, 15, 10, 30).getTime() // 2026-06-15 local
    expect(dayKey(at)).toBe('20260615')
  })
})
