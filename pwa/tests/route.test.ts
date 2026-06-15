import { describe, it, expect } from 'vitest'
import { parseRoute } from '../src/lib/shared'

describe('parseRoute', () => {
  it('parses a match share link', () => {
    expect(parseRoute('#/m/abc123x')).toEqual({ type: 'match', token: 'abc123x' })
  })
  it('parses a training share link', () => {
    expect(parseRoute('#/t/0a9z8y7')).toEqual({ type: 'training', token: '0a9z8y7' })
  })
  it('falls back to home for anything else', () => {
    expect(parseRoute('')).toEqual({ type: 'home' })
    expect(parseRoute('#')).toEqual({ type: 'home' })
    expect(parseRoute('#/x/foo')).toEqual({ type: 'home' })
  })
})
