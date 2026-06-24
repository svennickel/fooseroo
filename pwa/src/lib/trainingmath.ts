// Pure training helpers shared by the capture screen, the charts and the
// evaluations — kept side-effect-free (no DOM, no storage) so they're unit-
// testable and mirror the app's TimeFormat / TimeBounds / countdown colouring
// exactly (round half-up to a tenth; the same colour stops as TimeMeasureFragment).

// Millis → total tenths of a second, rounded half-up (magnitude only). Matches
// TimeFormat.tenths so a 14.96s result carries to "15.0s" like the app.
export function tenths(ms: number): number {
  return Math.round(Math.abs(ms) / 100)
}

// Elapsed time as "S.ts" (rounded, no sign). 14_750 → "14.8s".
export function fmtElapsed(ms: number): string {
  const t = tenths(ms)
  return `${Math.floor(t / 10)}.${t % 10}s`
}

// Like fmtElapsed but a negative value carries an explicit "-" ("-3.5s").
export function signedElapsed(ms: number): string {
  const s = fmtElapsed(ms)
  return ms < 0 ? `-${s}` : s
}

// Trims whole seconds: 12000 → "12s", 3500 → "3.5s" (DailyTimesChartView.secondsLabel).
export function secondsLabel(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000}s` : fmtElapsed(ms)
}

// "8s" / "8.5s" for a seconds value (TimeBounds.s()).
function secs(v: number): string {
  return `${Number.isInteger(v) ? v : v}s`
}

// The category bounds suffix, like TimeBounds.timeBoundLabel:
//   both → " – 8s–12s", from → " – ab 8s", to → " – bis 12s", none → "".
export function timeBoundLabel(from: number | null | undefined, to: number | null | undefined, lang: 'de' | 'en' = 'de'): string {
  const f = from ?? null, t = to ?? null
  let core: string
  if (f != null && t != null) core = `${secs(f)}–${secs(t)}`
  else if (f != null) core = lang === 'en' ? `from ${secs(f)}` : `ab ${secs(f)}`
  else if (t != null) core = lang === 'en' ? `up to ${secs(t)}` : `bis ${secs(t)}`
  else return ''
  return ` – ${core}`
}

// ---- Countdown colour (mirrors TimeMeasureFragment.currentColor) -------------
// The visible measurement clock fades neutral → green near the start, to amber at
// the limit, then to red as it runs into the OVERTIME negative.
export const OVERTIME_MS = 10_000
const C_NEUTRAL = '#CFD8DC' // countdown_neutral
const C_RUN = '#43A047'     // countdown_run
const C_WARN = '#F9A825'    // countdown_warn
const C_OVER = '#E53935'    // countdown_over

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function blend(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b)
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const bl = Math.round(ab + (bb - ab) * t)
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`
}

// Days since 1970-01-01 for the LOCAL calendar date of `at` — matches Java
// LocalDate.toEpochDay(), and is the 20-bit "day number" packed into a training
// share token (yyyymmdd would overflow 20 bits; epoch days stay well under it).
export function epochDay(at: number): number {
  const d = new Date(at)
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000)
}

// remainingMs = limitMs − elapsedMs (can be negative). limitMs = rod * 1000.
export function countdownColor(remainingMs: number, limitMs: number): string {
  const stops: [number, string][] = [
    [limitMs, C_NEUTRAL],
    [limitMs - 500, C_RUN],
    [0, C_WARN],
    [-OVERTIME_MS, C_OVER]
  ]
  const index = stops.findIndex(([offset]) => offset <= remainingMs)
  if (index <= 0) return stops[Math.max(index, 0)][1]
  const [startOffset, startColor] = stops[index - 1]
  const [endOffset, endColor] = stops[index]
  const ratio = (startOffset - remainingMs) / (startOffset - endOffset)
  return blend(startColor, endColor, Math.max(0, Math.min(1, ratio)))
}
