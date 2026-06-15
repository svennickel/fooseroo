<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from './lib/supabase'
  import { requestCode, verifyCode } from './lib/auth'

  type Step = 'loading' | 'email' | 'code' | 'in'
  let step = $state<Step>('loading')
  let email = $state('')
  let code = $state('')
  let userEmail = $state<string | null>(null)
  let busy = $state(false)
  let error = $state('')

  onMount(() => {
    supabase.auth.getSession().then(({ data }) => {
      userEmail = data.session?.user.email ?? null
      step = data.session ? 'in' : 'email'
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      userEmail = session?.user.email ?? null
      if (session) step = 'in'
      else if (step === 'in') step = 'email'
    })
    return () => sub.subscription.unsubscribe()
  })

  async function send() {
    busy = true; error = ''
    try { await requestCode(email.trim()); step = 'code' }
    catch (e) { error = (e as Error).message }
    finally { busy = false }
  }
  async function verify() {
    busy = true; error = ''
    try { await verifyCode(email.trim(), code) }
    catch (e) { error = (e as Error).message }
    finally { busy = false }
  }
  async function signOut() { await supabase.auth.signOut(); step = 'email'; code = '' }
</script>

<main>
  <h1>⚽ Fooseroo <span class="tag">Web</span></h1>

  {#if step === 'loading'}
    <p class="hint">Lädt…</p>
  {:else if step === 'in'}
    <p>Angemeldet als <strong>{userEmail}</strong>.</p>
    <p class="hint">Deine Matches &amp; Trainings erscheinen hier in Kürze – inkl. Live-Ansicht.</p>
    <button class="ghost" onclick={signOut}>Abmelden</button>
  {:else if step === 'email'}
    <p>Melde dich an, um deine Matches &amp; Trainings (und geteilte Inhalte) hier zu sehen.</p>
    <input type="email" inputmode="email" autocomplete="email"
           bind:value={email} placeholder="E-Mail-Adresse" />
    <button onclick={send} disabled={busy || !email.includes('@')}>Code per E-Mail senden</button>
  {:else}
    <p>Gib den Code ein, den wir an <strong>{email}</strong> geschickt haben.</p>
    <input inputmode="numeric" autocomplete="one-time-code"
           bind:value={code} placeholder="Code" />
    <button onclick={verify} disabled={busy || !code.trim()}>Anmelden</button>
    <button class="ghost" onclick={() => { step = 'email'; code = '' }}>Andere E-Mail</button>
  {/if}

  {#if error}<p class="err">{error}</p>{/if}
</main>

<style>
  :global(body) { margin: 0; font-family: system-ui, -apple-system, sans-serif;
    background: #0e1a12; color: #e8f0ea; }
  main { max-width: 440px; margin: 0 auto; padding: 36px 20px;
    display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .tag { font-size: 13px; background: #1f3a28; color: #81c784; padding: 2px 8px;
    border-radius: 8px; vertical-align: middle; }
  p { margin: 0; line-height: 1.5; }
  .hint { color: #9fb6a6; }
  .err { color: #ff8a80; }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid #2d4636;
    background: #16271c; color: #e8f0ea; font-size: 16px; }
  button { padding: 12px 14px; border-radius: 10px; border: 0; background: #4caf50;
    color: #06210f; font-weight: 700; font-size: 16px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: #81c784; border: 1px solid #2d4636;
    font-weight: 600; }
</style>
