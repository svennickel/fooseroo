import { supabase } from './supabase'
import { detectLang } from './lang'

// Email one-time-code sign-in, mirroring the Android flow. The data payload drives
// the branded OTP e-mail template (Fooseroo vs Readings, de/en).
export async function requestCode(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      data: { app: 'Fooseroo', lang: detectLang(navigator.language) }
    }
  })
  if (error) throw error
}

export async function verifyCode(email: string, token: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: 'email' })
  if (error) throw error
}
