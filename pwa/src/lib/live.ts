// Read-aloud (Web Speech API) and a screen wake lock for the live match detail —
// the web counterparts of the app's LiveCommentary (TextToSpeech) and its
// keepScreenOn-while-live behaviour.

export const speechSupported = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window

export function speak(text: string) {
  if (!speechSupported()) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'de-DE'
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  } catch { /* ignore */ }
}

export function cancelSpeech() {
  if (!speechSupported()) return
  try { window.speechSynthesis.cancel() } catch { /* ignore */ }
}

// Screen wake lock: keeps the device awake while a live match detail is open.
// Auto-released by the browser when the tab is hidden, so the caller re-acquires
// on visibilitychange. Silently a no-op where the API is unavailable.
type SentinelLike = { release: () => Promise<void>; addEventListener?: (t: string, cb: () => void) => void }
let sentinel: SentinelLike | null = null
let wanted = false

export function wakeLockSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

export async function acquireWakeLock() {
  wanted = true
  if (!wakeLockSupported() || sentinel) return
  try {
    sentinel = await (navigator as unknown as { wakeLock: { request: (t: string) => Promise<SentinelLike> } })
      .wakeLock.request('screen')
    sentinel.addEventListener?.('release', () => { sentinel = null })
  } catch { sentinel = null }
}

export async function releaseWakeLock() {
  wanted = false
  const s = sentinel; sentinel = null
  try { await s?.release() } catch { /* ignore */ }
}

// Re-acquire after the tab becomes visible again (locks drop while hidden).
export function reacquireWakeLockIfWanted() {
  if (wanted && !sentinel && document.visibilityState === 'visible') acquireWakeLock()
}
