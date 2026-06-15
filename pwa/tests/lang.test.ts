import { describe, it, expect } from 'vitest'
import { detectLang } from '../src/lib/lang'

describe('detectLang', () => {
  it('maps English locales to en', () => {
    expect(detectLang('en')).toBe('en')
    expect(detectLang('en-US')).toBe('en')
    expect(detectLang('EN-GB')).toBe('en')
  })
  it('defaults everything else to German', () => {
    expect(detectLang('de')).toBe('de')
    expect(detectLang('de-DE')).toBe('de')
    expect(detectLang('fr')).toBe('de')
    expect(detectLang(undefined)).toBe('de')
    expect(detectLang(null)).toBe('de')
  })
})
