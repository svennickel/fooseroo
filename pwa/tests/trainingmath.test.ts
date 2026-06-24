import { describe, it, expect } from 'vitest'
import { tenths, fmtElapsed, signedElapsed, secondsLabel, timeBoundLabel, countdownColor, epochDay, OVERTIME_MS } from '../src/lib/trainingmath'
import { encodeTraining, decodeTraining } from '../src/lib/share'

describe('tenths (round half-up, like the app)', () => {
  it('rounds to a tenth of a second', () => {
    expect(tenths(14750)).toBe(148)   // 14.75 → 14.8 (not truncated to 14.7)
    expect(tenths(14960)).toBe(150)   // carries to 15.0
    expect(tenths(-3500)).toBe(35)    // magnitude only
  })
})

describe('fmtElapsed / signedElapsed', () => {
  it('formats rounded tenths with a unit', () => {
    expect(fmtElapsed(5000)).toBe('5.0s')
    expect(fmtElapsed(14750)).toBe('14.8s')
    expect(fmtElapsed(14960)).toBe('15.0s')
  })
  it('carries a sign only when negative', () => {
    expect(signedElapsed(400)).toBe('0.4s')
    expect(signedElapsed(-3500)).toBe('-3.5s')
  })
})

describe('secondsLabel', () => {
  it('trims whole seconds', () => {
    expect(secondsLabel(12000)).toBe('12s')
    expect(secondsLabel(3500)).toBe('3.5s')
  })
})

describe('timeBoundLabel', () => {
  it('mirrors TimeBounds: range / from / to / none', () => {
    expect(timeBoundLabel(8, 12)).toBe(' – 8s–12s')
    expect(timeBoundLabel(8, null)).toBe(' – ab 8s')
    expect(timeBoundLabel(null, 12)).toBe(' – bis 12s')
    expect(timeBoundLabel(null, null)).toBe('')
    expect(timeBoundLabel(8, null, 'en')).toBe(' – from 8s')
  })
})

describe('epochDay (training share day number)', () => {
  it('is days since 1970-01-01 for the local date', () => {
    const at = new Date(2026, 5, 24, 18, 30).getTime() // 2026-06-24 local
    expect(epochDay(at)).toBe(Math.floor(Date.UTC(2026, 5, 24) / 86400000))
  })
  it('is the same for any time on the same local day', () => {
    expect(epochDay(new Date(2026, 5, 24, 0, 1).getTime()))
      .toBe(epochDay(new Date(2026, 5, 24, 23, 59).getTime()))
  })
  it('fits the 20-bit training token and round-trips through the codec', () => {
    const gid = 'b3f1c2d4-5e6a-47b8-9c0d-1e2f3a4b5c6d'
    const dn = epochDay(new Date(2026, 5, 24).getTime())
    expect(dn).toBeLessThan(1 << 20)
    expect(decodeTraining(encodeTraining(gid, dn))?.dayNumber).toBe(dn)
  })
})

describe('countdownColor (TimeMeasureFragment colour stops)', () => {
  const LIMIT = 10000
  it('is neutral grey at the very start', () => {
    expect(countdownColor(LIMIT, LIMIT).toUpperCase()).toBe('#CFD8DC')
  })
  it('is green once running', () => {
    expect(countdownColor(LIMIT - 500, LIMIT).toUpperCase()).toBe('#43A047')
  })
  it('is amber at the limit (remaining 0)', () => {
    expect(countdownColor(0, LIMIT).toUpperCase()).toBe('#F9A825')
  })
  it('is red once fully into overtime', () => {
    expect(countdownColor(-OVERTIME_MS, LIMIT).toUpperCase()).toBe('#E53935')
  })
  it('blends between stops (between green and amber)', () => {
    const c = countdownColor(LIMIT / 2 - 250, LIMIT)
    expect(c).toMatch(/^#[0-9a-f]{6}$/)
    expect(c.toUpperCase()).not.toBe('#43A047')
    expect(c.toUpperCase()).not.toBe('#F9A825')
  })
})
