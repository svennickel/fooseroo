// Local preferences mirrored from the app's SharedPreferences: terms acceptance,
// onboarding-shown, anonymous-statistics consent (default OFF), and the theme mode
// (System/Hell/Dunkel). All persisted in the browser (localStorage).

export type ThemeMode = 'system' | 'light' | 'dark'

const K = {
  terms: 'fs_terms_accepted',
  onboard: 'fs_onboarding_shown',
  stats: 'fs_anonymous_statistics',
  theme: 'fs_theme_mode'
}

const get = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const set = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export const termsAccepted = () => get(K.terms) === '1'
export const markTermsAccepted = () => set(K.terms, '1')
export const onboardingShown = () => get(K.onboard) === '1'
export const markOnboardingShown = () => set(K.onboard, '1')

export const analyticsEnabled = () => get(K.stats) === '1'
export const setAnalytics = (on: boolean) => set(K.stats, on ? '1' : '0')

export const getTheme = (): ThemeMode => {
  const v = get(K.theme)
  return v === 'light' || v === 'dark' ? v : 'system'
}

// Apply the theme by toggling a data-theme attribute on <html>; the CSS forces the
// palette for light/dark and falls back to prefers-color-scheme for "system". Also
// nudges the status-bar theme-color to the effective background.
export function applyTheme(mode: ThemeMode) {
  set(K.theme, mode)
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
  const dark = mode === 'dark' ||
    (mode === 'system' && typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches)
  const m = document.querySelector('meta[name="theme-color"]:not([media])')
    || (() => { const e = document.createElement('meta'); e.setAttribute('name', 'theme-color'); document.head.appendChild(e); return e })()
  m.setAttribute('content', dark ? '#111418' : '#E8F0FB')
}
