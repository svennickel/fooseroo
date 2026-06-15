<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from './lib/supabase'
  import { requestCode, verifyCode } from './lib/auth'
  import { parseRoute, resolveSharedMatch, type SharedMatch, type Route } from './lib/shared'
  import { loadPersonalMatches, loadPersonalTraining, winnerSide, formatElapsed,
    type MatchItem, type TrainingItem } from './lib/data'

  let route = $state<Route>({ type: 'home' })
  let signedIn = $state(false)
  let userEmail = $state<string | null>(null)
  let ready = $state(false)

  // Auth form
  let step = $state<'email' | 'code'>('email')
  let email = $state('')
  let code = $state('')
  let busy = $state(false)
  let error = $state('')

  // Shared content
  let shared = $state<SharedMatch | null>(null)
  let sharedState = $state<'idle' | 'loading' | 'notfound' | 'error'>('idle')

  // Own (personal) matches list
  let matches = $state<MatchItem[]>([])
  let matchesState = $state<'idle' | 'loading' | 'error'>('idle')
  let training = $state<TrainingItem[]>([])

  const kindLabel = (k: TrainingItem['kind']) =>
    k === 'measure' ? 'Zeitmessung' : k === 'measure_success' ? 'Zeit & Erfolg' : 'Erfolgsquote'

  const fmtDate = (at: number) =>
    new Date(at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })

  onMount(() => {
    route = parseRoute(location.hash)
    addEventListener('hashchange', () => { route = parseRoute(location.hash); maybeResolve() })
    supabase.auth.getSession().then(({ data }) => {
      signedIn = !!data.session; userEmail = data.session?.user.email ?? null
      ready = true; maybeResolve()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      signedIn = !!session; userEmail = session?.user.email ?? null
      if (session) { step = 'email'; code = '' }
      maybeResolve()
    })
    return () => sub.subscription.unsubscribe()
  })

  async function maybeResolve() {
    if (route.type === 'match' && signedIn) {
      sharedState = 'loading'; shared = null
      const r = await resolveSharedMatch(route.token)
      if (r.status === 'ok') { shared = r.data; sharedState = 'idle' }
      else sharedState = r.status === 'auth' ? 'idle' : r.status
    } else if (route.type === 'home' && signedIn) {
      matchesState = 'loading'
      try {
        const [m, t] = await Promise.all([loadPersonalMatches(), loadPersonalTraining()])
        matches = m; training = t; matchesState = 'idle'
      } catch { matchesState = 'error' }
    }
  }

  async function send() {
    busy = true; error = ''
    try { await requestCode(email.trim()); step = 'code' }
    catch (e) { error = (e as Error).message } finally { busy = false }
  }
  async function verify() {
    busy = true; error = ''
    try { await verifyCode(email.trim(), code) }
    catch (e) { error = (e as Error).message } finally { busy = false }
  }
  async function signOut() { await supabase.auth.signOut() }

  const needsAuthForShare = $derived(route.type !== 'home' && !signedIn)
</script>

<main>
  <h1>⚽ Fooseroo <span class="tag">Web</span></h1>

  {#if !ready}
    <p class="hint">Lädt…</p>

  {:else if route.type === 'match'}
    <!-- Shared match deep link -->
    {#if needsAuthForShare}
      <p>Ein geteiltes Match wurde mit dir geteilt. Melde dich an, um es anzusehen.</p>
      {@render authForm()}
    {:else if sharedState === 'loading'}
      <p class="hint">Geteiltes Match wird geladen…</p>
    {:else if shared}
      <div class="card">
        <div class="meta">{shared.groupName} · geteiltes Match</div>
        <div class="score">
          <span class="team" class:win={shared.setsHome > shared.setsAway}>{shared.homeName}</span>
          <span class="sets">{shared.setsHome} : {shared.setsAway}</span>
          <span class="team" class:win={shared.setsAway > shared.setsHome}>{shared.awayName}</span>
        </div>
      </div>
      <a class="ghost-link" href="#/">Zur Übersicht</a>
    {:else if sharedState === 'notfound'}
      <p>Dieses geteilte Match wurde nicht gefunden. Möglicherweise bist du kein Mitglied der Gruppe oder es wurde gelöscht.</p>
      <a class="ghost-link" href="#/">Zur Übersicht</a>
    {:else}
      <p class="err">Das Match konnte nicht geladen werden. Bitte später erneut versuchen.</p>
    {/if}

  {:else if route.type === 'training'}
    <p>Geteilte Trainings-Ansicht folgt in Kürze.</p>
    <a class="ghost-link" href="#/">Zur Übersicht</a>

  {:else if signedIn}
    <div class="row">
      <span class="hint">Angemeldet als {userEmail}</span>
      <button class="ghost small" onclick={signOut}>Abmelden</button>
    </div>
    <h2>Deine Matches</h2>
    {#if matchesState === 'loading'}
      <p class="hint">Lädt…</p>
    {:else if matchesState === 'error'}
      <p class="err">Matches konnten nicht geladen werden.</p>
    {:else if matches.length === 0}
      <p class="hint">Noch keine gespeicherten Matches in „Dein Konto". Erfasse welche in der App – sie erscheinen hier.</p>
    {:else}
      <ul class="list">
        {#each matches as m}
          {@const w = winnerSide(m.setsHome, m.setsAway)}
          <li class="card">
            <div class="score">
              <span class="team" class:win={w === 'home'}>{m.homeName}</span>
              <span class="sets">{m.setsHome} : {m.setsAway}</span>
              <span class="team" class:win={w === 'away'}>{m.awayName}</span>
            </div>
            <div class="meta">{fmtDate(m.at)}{#if m.category} · {m.category}{/if}</div>
          </li>
        {/each}
      </ul>
    {/if}

    <h2>Dein Training</h2>
    {#if matchesState === 'loading'}
      <p class="hint">Lädt…</p>
    {:else if training.length === 0}
      <p class="hint">Noch keine Trainingsergebnisse in „Dein Konto".</p>
    {:else}
      <ul class="list">
        {#each training.slice(0, 50) as t}
          <li class="card trow">
            <div>
              <strong>{t.name || '—'}</strong>
              <span class="meta">{kindLabel(t.kind)}{#if t.mode} · {t.mode}{/if}</span>
            </div>
            <div class="tval">
              {#if t.kind === 'outcome'}
                <span class={t.success ? 'ok' : 'bad'}>{t.success ? '✓' : '✗'}</span>
              {:else}
                {#if t.elapsedMs !== undefined}{formatElapsed(t.elapsedMs)}{/if}
                {#if t.kind === 'measure_success'}<span class={t.success ? 'ok' : 'bad'}>{t.success ? ' ✓' : ' ✗'}</span>{/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="hint">Live-Ansicht &amp; Erfassung folgen.</p>

  {:else}
    <p>Melde dich an, um deine Matches &amp; Trainings (und geteilte Inhalte) hier zu sehen.</p>
    {@render authForm()}
  {/if}
</main>

{#snippet authForm()}
  {#if step === 'email'}
    <input type="email" inputmode="email" autocomplete="email"
           bind:value={email} placeholder="E-Mail-Adresse" />
    <button onclick={send} disabled={busy || !email.includes('@')}>Code per E-Mail senden</button>
  {:else}
    <p class="hint">Code aus der E-Mail an <strong>{email}</strong>:</p>
    <input inputmode="numeric" autocomplete="one-time-code" bind:value={code} placeholder="Code" />
    <button onclick={verify} disabled={busy || !code.trim()}>Anmelden</button>
    <button class="ghost" onclick={() => { step = 'email'; code = '' }}>Andere E-Mail</button>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
{/snippet}

<style>
  :global(body) { margin: 0; font-family: system-ui, -apple-system, sans-serif;
    background: #0e1a12; color: #e8f0ea; }
  main { max-width: 440px; margin: 0 auto; padding: 36px 20px;
    display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .tag { font-size: 13px; background: #1f3a28; color: #81c784; padding: 2px 8px;
    border-radius: 8px; vertical-align: middle; }
  p { margin: 0; line-height: 1.5; }
  .hint { color: #9fb6a6; } .err { color: #ff8a80; }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid #2d4636;
    background: #16271c; color: #e8f0ea; font-size: 16px; }
  button { padding: 12px 14px; border-radius: 10px; border: 0; background: #4caf50;
    color: #06210f; font-weight: 700; font-size: 16px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: #81c784; border: 1px solid #2d4636;
    font-weight: 600; }
  .ghost-link { color: #81c784; }
  .card { background: #16271c; border: 1px solid #2d4636; border-radius: 16px; padding: 20px; }
  .meta { color: #9fb6a6; font-size: 13px; margin-bottom: 12px; }
  .score { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .team { flex: 1; font-weight: 600; }
  .team:last-child { text-align: right; }
  .team.win { color: #81c784; }
  .sets { font-size: 26px; font-weight: 800; }
  h2 { font-size: 18px; margin: 8px 0 2px; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  button.small { padding: 6px 10px; font-size: 13px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .trow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; }
  .trow .meta { margin-left: 8px; }
  .tval { font-weight: 700; white-space: nowrap; }
  .ok { color: #81c784; } .bad { color: #ff8a80; }
</style>
