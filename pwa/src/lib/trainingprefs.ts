// Device-local training options — the per-category settings the app keeps in
// SharedPreferences but does NOT sync via CloudConfig (so they're effectively
// per-device even in the app): rod limits (ITSF 10/15 vs Saarland 20/20), the
// counting direction, and per-mode button mode / hidden counter / outcome target.
// Scoped by context (null = personal, else group id), like the app swaps its bare
// keys per context. Stored in localStorage.
import type { Ctx } from './data'

export type ButtonMode = 'BOTH' | 'SHORT' | 'LONG'

const ctxTag = (ctx: Ctx) => (ctx ? `g:${ctx}` : 'p')
function readMap<T>(key: string): Record<string, T> {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : {} } catch { return {} }
}
function writeMap<T>(key: string, m: Record<string, T>): void {
  try { localStorage.setItem(key, JSON.stringify(m)) } catch { /* ignore */ }
}

// ---- Rod limits (ITSF 10/15 default, Saarland 20/20) — global, not per-context.
export type RodMode = 'ITSF' | 'Saarland'
export function rodMode(): RodMode {
  try { return localStorage.getItem('fs_time_limits') === 'Saarland' ? 'Saarland' : 'ITSF' } catch { return 'ITSF' }
}
export function setRodMode(m: RodMode): void {
  try { localStorage.setItem('fs_time_limits', m) } catch { /* ignore */ }
}
export function rodLimits(): { short: number; long: number } {
  return rodMode() === 'Saarland' ? { short: 20, long: 20 } : { short: 10, long: 15 }
}

// ---- Counting direction of the visible clock (default UP = elapsed). ----------
export function countdownDescending(): boolean {
  try { return localStorage.getItem('fs_countdown_descending') === '1' } catch { return false }
}
export function setCountdownDescending(v: boolean): void {
  try { localStorage.setItem('fs_countdown_descending', v ? '1' : '0') } catch { /* ignore */ }
}

// ---- Per-mode offered buttons ("BOTH"/"SHORT"/"LONG"). ------------------------
function buttonsKey(ctx: Ctx, kind: string) { return `fs_train_buttons:${ctxTag(ctx)}:${kind}` }
export function buttonModeOf(ctx: Ctx, kind: string, mode: string): ButtonMode {
  return readMap<ButtonMode>(buttonsKey(ctx, kind))[mode] ?? 'BOTH'
}
export function setButtonMode(ctx: Ctx, kind: string, mode: string, val: ButtonMode): void {
  const m = readMap<ButtonMode>(buttonsKey(ctx, kind)); m[mode] = val; writeMap(buttonsKey(ctx, kind), m)
}

// ---- Per-mode hidden running counter. ----------------------------------------
function hiddenKey(ctx: Ctx, kind: string) { return `fs_train_hidden:${ctxTag(ctx)}:${kind}` }
export function counterHiddenOf(ctx: Ctx, kind: string, mode: string): boolean {
  return readMap<boolean>(hiddenKey(ctx, kind))[mode] ?? false
}
export function setCounterHidden(ctx: Ctx, kind: string, mode: string, val: boolean): void {
  const m = readMap<boolean>(hiddenKey(ctx, kind)); m[mode] = val; writeMap(hiddenKey(ctx, kind), m)
}

// ---- Erfolgsquote target percent per mode (outcome_targets in the app). -------
function targetKey(ctx: Ctx) { return `fs_outcome_targets:${ctxTag(ctx)}` }
export function outcomeTargetOf(ctx: Ctx, mode: string): number | null {
  const v = readMap<number>(targetKey(ctx))[mode]
  return typeof v === 'number' ? v : null
}
export function setOutcomeTarget(ctx: Ctx, mode: string, val: number | null): void {
  const m = readMap<number>(targetKey(ctx))
  if (val == null) delete m[mode]; else m[mode] = val
  writeMap(targetKey(ctx), m)
}
