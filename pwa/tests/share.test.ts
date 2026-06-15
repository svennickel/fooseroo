import { describe, it, expect } from 'vitest'
import { encodeMatch, decodeMatch, encodeTraining, decodeTraining, groupHash } from '../src/lib/share'

// A representative group id (Supabase uuid).
const GID = 'b3f1c2d4-5e6a-47b8-9c0d-1e2f3a4b5c6d'

describe('ShareCodec port', () => {
  it('groupHash is a 16-bit value, stable', () => {
    const h = groupHash(GID)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffff)
    expect(groupHash(GID)).toBe(h) // deterministic
  })

  it('match token round-trips (hash + timestamp)', () => {
    const ts = 1_750_000_000_000 // ~2025, fits in 42 bits
    const token = encodeMatch(GID, ts)
    expect(token.length).toBeGreaterThanOrEqual(7)
    expect(token).toMatch(/^[0-9a-z]+$/)
    const d = decodeMatch(token)
    expect(d).not.toBeNull()
    expect(d!.groupHash).toBe(groupHash(GID))
    expect(d!.timestampMillis).toBe(ts)
  })

  it('training token round-trips (hash + day number)', () => {
    const day = 20260615
    const token = encodeTraining(GID, day & ((1 << 20) - 1))
    const d = decodeTraining(token)
    expect(d).not.toBeNull()
    expect(d!.groupHash).toBe(groupHash(GID))
    expect(d!.dayNumber).toBe(day & ((1 << 20) - 1))
  })

  it('tokens are not a visible running number (multiply spreads bits)', () => {
    const a = encodeMatch(GID, 1_750_000_000_000)
    const b = encodeMatch(GID, 1_750_000_000_001) // +1ms
    expect(a).not.toBe(b)
    // adjacent timestamps must not produce adjacent-looking tokens
    expect(b.slice(0, 4)).not.toBe(a.slice(0, 4))
  })

  it('malformed tokens decode to null', () => {
    expect(decodeMatch('')).toBeNull()
    expect(decodeMatch('!!!')).toBeNull()
  })
})
