// "en" for English UI locales, otherwise German (the app's default). Used for the
// app-aware OTP e-mail template (.Data.lang) and the UI.
export function detectLang(locale: string | undefined | null): 'en' | 'de' {
  return (locale ?? '').toLowerCase().startsWith('en') ? 'en' : 'de'
}
