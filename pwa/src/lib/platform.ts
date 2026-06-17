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
