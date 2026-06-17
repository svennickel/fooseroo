import { supabase } from './supabase'
import { detectLang } from './lang'
import { otpCodeOnly } from './platform'

// The web app's own URL — passed as emailRedirectTo so the OTP e-mail can tell a
// WEB-initiated sign-in apart from an app one (.RedirectTo in the template),
// independently of the user's stored metadata. The branded template uses it to
// show Fooseroo (not the shared Readings app) and route the button back to the web.
const WEB_URL = (() => {
  try { return new URL('./', location.href).href } catch { return 'https://fooseroo.app/app/' }
})()
// Installed iOS PWA: a magic link can't return to the standalone app, so signal the
// template (via .RedirectTo) to render the CODE only — no link button.
const NOLINK_URL = `${WEB_URL}?nolink=1`

// Email one-time-code sign-in, mirroring the Android flow. data.app/lang brand the
// e-mail for NEW users; platform + emailRedirectTo make the web case reliable for
// EXISTING users too (whose metadata is not updated on sign-in).
export async function requestCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: otpCodeOnly() ? NOLINK_URL : WEB_URL,
      data: { app: 'Fooseroo', lang: detectLang(navigator.language), platform: 'web' }
    }
  })
  if (error) throw error
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'email' })
  if (error) throw error
}
