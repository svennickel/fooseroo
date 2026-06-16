import { createClient } from '@supabase/supabase-js'

// Same backend as the Android app. The publishable key is client-safe (RLS guards
// every row); it is the same key the Android client ships.
const SUPABASE_URL = 'https://efbidjdrxjrmnmdtgell.supabase.co'
const SUPABASE_KEY = 'sb_publishable_YD4f5-FaEtqq9A2k3p78kA__VUeQfLM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: { schema: 'fooseroo' },
  // detectSessionInUrl: the web OTP one-tap link goes through Supabase's verify
  // endpoint (on supabase.co, so the Android app never intercepts it) and redirects
  // back to /app/ with the session in the URL — picked up here to complete login.
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})
