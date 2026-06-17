// Coarse OS detection so the PWA can meet platform UI expectations (iOS users run
// the web app — there is no native iOS app). Used to swap Android/Material patterns
// (vertical ⋮ overflow, dropdown menus, "←" back) for iOS ones (••• ellipsis, a
// bottom action sheet, a "‹" back chevron).
export const isIOS = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS reports as desktop Safari (MacIntel) but is touch.
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1
})()

// Running as an installed (standalone) PWA — display-mode standalone, or iOS Safari's
// legacy navigator.standalone. A function (the mode can differ per launch).
export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true
  } catch { /* ignore */ }
  return (navigator as unknown as { standalone?: boolean }).standalone === true
}

// On iOS, an installed PWA can never receive a magic-link back (the link opens
// Safari, not the standalone app) — so its OTP mail must offer the CODE only.
export function otpCodeOnly(): boolean {
  return isIOS && isStandalonePWA()
}
