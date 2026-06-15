<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from './lib/supabase'
  import { requestCode, verifyCode } from './lib/auth'
  import { parseRoute, resolveSharedMatch, type SharedMatch, type Route } from './lib/shared'
  import { loadPersonalMatches, loadPersonalTraining, winnerSide, formatElapsed,
    type MatchItem, type TrainingItem } from './lib/data'
  import { parseMatchState } from './lib/match'

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

  // Match detail / live view
  let selected = $state<MatchItem | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  const view = $derived(selected ? parseMatchState(selected.state, selected.running) : null)

  function openMatch(m: MatchItem) {
    selected = m
    stopPoll()
    if (m.running) {
      // Live: refresh the open match every few seconds (the running row updates as
      // the editor scores). A realtime channel is a later refinement.
      pollTimer = setInterval(refreshSelected, 3500)
    }
  }
  function closeMatch() { stopPoll(); selected = null }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
  async function refreshSelected() {
    if (!selected) return
    try {
      const all = await loadPersonalMatches()
      matches = all
      const at = selected.at
      const fresh = all.find((m) => m.at === at)
      if (fresh) selected = fresh
      if (!fresh || !fresh.running) stopPoll()
    } catch { /* keep showing last state */ }
  }

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

  {#if selected && view}
    <button class="ghost small back" onclick={closeMatch}>← Zurück</button>
    <div class="detail">
      {#if selected.running}<div class="live big"><span class="dot"></span> LIVE</div>{/if}
      <div class="hero">
        <div class="hname" class:win={!selected.running && selected.setsHome > selected.setsAway}>{selected.homeName}</div>
        <div class="hsets">{selected.setsHome} : {selected.setsAway}</div>
        <div class="hname" class:win={!selected.running && selected.setsAway > selected.setsHome}>{selected.awayName}</div>
      </div>
      <div class="meta center">{fmtDate(selected.at)}{#if selected.category} · {selected.category}{/if}</div>

      <div class="sets-row">
        {#each view.sets as s}<span class="setchip">{s.a}:{s.b}</span>{/each}
        {#if selected.running && view.current}<span class="setchip cur">{view.current.a}:{view.current.b}</span>{/if}
      </div>

      {#if selected.running && view.current}
        <div class="curset">
          <div class="cg" class:srv={view.serve === 'A'}>
            <div class="num">{view.current.a}</div>
            <div class="to">{'•'.repeat(view.timeoutsA)}</div>
          </div>
          <div class="csep">:</div>
          <div class="cg" class:srv={view.serve === 'B'}>
            <div class="num">{view.current.b}</div>
            <div class="to">{'•'.repeat(view.timeoutsB)}</div>
          </div>
        </div>
        <div class="hint center">Laufender Satz · Aufschlag: {view.serve === 'A' ? selected.homeName : view.serve === 'B' ? selected.awayName : '—'}</div>
      {/if}

      {#if view.goals.length}
        <h2>Verlauf</h2>
        <ul class="prog">
          {#each view.goals as g}
            <li>
              <span class="pteam" class:ha={g.team === 'A'} class:hb={g.team === 'B'}>{g.team === 'A' ? selected.homeName : selected.awayName}</span>
              <span class="pscore">{g.a}:{g.b}</span>
              <span class="pset">Satz {g.set + 1}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

  {:else if !ready}
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
          <li>
            <button class="card card-btn" onclick={() => openMatch(m)}>
              {#if m.running}<div class="live"><span class="dot"></span> LIVE</div>{/if}
              <div class="score">
                <span class="team" class:win={!m.running && w === 'home'}>{m.homeName}</span>
                <span class="sets">{m.setsHome} : {m.setsAway}</span>
                <span class="team" class:win={!m.running && w === 'away'}>{m.awayName}</span>
              </div>
              <div class="meta">{fmtDate(m.at)}{#if m.category} · {m.category}{/if}</div>
            </button>
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

  /* clickable list cards */
  .card-btn { width: 100%; text-align: left; background: #16271c; border: 1px solid #2d4636;
    color: inherit; font: inherit; font-weight: 400; display: block; }
  .card-btn:active { background: #1b2f22; }

  /* live badge */
  .live { display: inline-flex; align-items: center; gap: 6px; color: #ff8a80; font-weight: 700;
    font-size: 12px; letter-spacing: .08em; margin-bottom: 8px; }
  .live.big { font-size: 14px; justify-content: center; margin-bottom: 4px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5252; display: inline-block;
    animation: pulse 1.2s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: .3 } }

  /* match detail */
  .back { align-self: flex-start; }
  .center { text-align: center; }
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .hname { font-size: 18px; font-weight: 700; }
  .hname:last-child { text-align: right; }
  .hname.win { color: #81c784; }
  .hsets { font-size: 34px; font-weight: 800; padding: 0 6px; }
  .sets-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .setchip { background: #16271c; border: 1px solid #2d4636; border-radius: 999px;
    padding: 4px 12px; font-weight: 600; }
  .setchip.cur { border-color: #4caf50; color: #81c784; }
  .curset { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;
    background: #16271c; border: 1px solid #2d4636; border-radius: 16px; padding: 18px; }
  .cg { text-align: center; }
  .cg.srv { color: #81c784; }
  .cg.srv .num::after { content: " •"; font-size: 18px; vertical-align: super; }
  .num { font-size: 48px; font-weight: 800; line-height: 1; }
  .to { color: #9fb6a6; min-height: 16px; letter-spacing: 3px; }
  .csep { font-size: 32px; font-weight: 800; color: #9fb6a6; }
  .prog { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column-reverse; gap: 4px; }
  .prog li { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 10px;
    padding: 8px 12px; background: #16271c; border-radius: 10px; }
  .pteam.ha { color: #81c784; } .pteam.hb { color: #ffcc80; }
  .pscore { font-weight: 800; } .pset { color: #9fb6a6; font-size: 12px; }
</style>
