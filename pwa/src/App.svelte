<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from './lib/supabase'
  import { requestCode, verifyCode } from './lib/auth'
  import { parseRoute, resolveSharedMatch, type SharedMatch, type Route } from './lib/shared'
  import { loadMatches, loadTraining, loadGroups, winnerSide, formatElapsed,
    type MatchItem, type TrainingItem, type Group, type Ctx } from './lib/data'
  import { parseMatchState, progressRows } from './lib/match'
  import MatchProgress from './lib/MatchProgress.svelte'

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

  // Context (Dein Konto / a group), category + day filters — like the app.
  let groups = $state<Group[]>([])
  let ctx = $state<Ctx>(null)
  let catFilter = $state<string>('')  // '' = all categories
  let dayFilter = $state<string>('')  // '' = all days; else a yyyy-mm-dd-ish key
  const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)
  const categories = $derived([...new Set(matches.map((m) => m.category).filter(Boolean))] as string[])
  const days = $derived([...new Set(matches.map((m) => dayOf(m.at)))])
  const shownMatches = $derived(matches.filter((m) =>
    (catFilter === '' || m.category === catFilter) && (dayFilter === '' || dayOf(m.at) === dayFilter)))
  const shownTraining = $derived(training.filter((t) => dayFilter === '' || dayOf(t.at) === dayFilter))

  // Matches / Training tabs (like the app's areas), persisted with the selectors.
  let tab = $state<'matches' | 'training'>('matches')
  const today = () => new Date().toISOString().slice(0, 10)
  const dayLabel = (d: string) => (d === today() ? 'Heute' : fmtDate(Date.parse(d)))

  // Newest day that has a match in ANY category, for the date pre-selection.
  function newestMatchDay(items: MatchItem[]): string {
    const ds = [...new Set(items.map((m) => dayOf(m.at)))].sort()
    return ds.at(-1) ?? ''
  }

  // Persist tab + context + category (NOT the day: a fresh page load jumps back to
  // the newest match day, see reloadData). Restored on mount unless the URL overrides.
  const LS = 'fs_sel'
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ tab, ctx, cat: catFilter })) } catch { /* ignore */ }
  }
  function restore(): { tab?: string; ctx?: Ctx; cat?: string } {
    try { return JSON.parse(localStorage.getItem(LS) ?? '{}') } catch { return {} }
  }

  const kindLabel = (k: TrainingItem['kind']) =>
    k === 'measure' ? 'Zeitmessung' : k === 'measure_success' ? 'Zeit & Erfolg' : 'Erfolgsquote'

  // Match detail / live view
  let selected = $state<MatchItem | null>(null)
  let pollTimer: ReturnType<typeof setInterval> | null = null
  const view = $derived(selected ? parseMatchState(selected.state, selected.running) : null)
  const progress = $derived(view ? progressRows(view, !!selected?.running) : null)

  function openMatch(m: MatchItem) {
    selected = m
    stopPoll(); stopListPoll()
    // Always poll while the detail is open, so a change or a switch to LIVE is
    // picked up even if the match wasn't running when opened (faster while live).
    pollTimer = setInterval(refreshSelected, m.running ? 3000 : 6000)
  }
  function closeMatch() { stopPoll(); selected = null; startListPoll() }

  // While the list is open (signed-in home, no detail), poll so new/changed/live
  // matches appear without a manual reload.
  let listTimer: ReturnType<typeof setInterval> | null = null
  function startListPoll() {
    stopListPoll()
    if (signedIn && route.type === 'home' && !selected)
      listTimer = setInterval(() => { if (!selected) reloadData() }, 6000)
  }
  function stopListPoll() { if (listTimer) { clearInterval(listTimer); listTimer = null } }
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
  async function refreshSelected() {
    if (!selected) return
    try {
      const all = await loadMatches(ctx)
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
    // Restore the last selection (tab / context / category); URL params override.
    const saved = restore()
    if (saved.tab === 'training' || saved.tab === 'matches') tab = saved.tab
    if (saved.ctx !== undefined) ctx = saved.ctx ?? null
    if (typeof saved.cat === 'string') catFilter = saved.cat
    const q = new URLSearchParams(location.search)
    if (q.get('tab') === 'training' || q.get('tab') === 'matches') tab = q.get('tab') as 'matches' | 'training'
    if (q.has('ctx')) ctx = q.get('ctx') || null
    if (q.has('cat')) catFilter = q.get('cat') || ''
    if (q.has('day')) dayFilter = q.get('day') || ''
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

  // Persist the selection and mirror it live into the URL (tab/ctx/cat/day), so a
  // reload or shared link restores the same view.
  $effect(() => {
    const t = tab, c = ctx, cat = catFilter, day = dayFilter
    persist()
    const q = new URLSearchParams()
    q.set('tab', t)
    if (c) q.set('ctx', c)
    if (cat) q.set('cat', cat)
    if (day) q.set('day', day)
    history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`)
  })

  async function maybeResolve() {
    if (route.type === 'match' && signedIn) {
      sharedState = 'loading'; shared = null
      const r = await resolveSharedMatch(route.token)
      if (r.status === 'ok') { shared = r.data; sharedState = 'idle' }
      else sharedState = r.status === 'auth' ? 'idle' : r.status
    } else if (route.type === 'home' && signedIn) {
      if (groups.length === 0) loadGroups().then((g) => { groups = g }).catch(() => {})
      await reloadData()
    }
  }

  async function reloadData() {
    matchesState = 'loading'
    try {
      const [m, t] = await Promise.all([loadMatches(ctx), loadTraining(ctx)])
      matches = m; training = t; matchesState = 'idle'
      // Pre-select the newest day that has a match (in any category) unless the
      // current day is still valid (e.g. from the URL or a manual pick this session).
      const mdays = [...new Set(m.map((x) => dayOf(x.at)))]
      if (!dayFilter || !mdays.includes(dayFilter)) dayFilter = newestMatchDay(m)
      // Drop a stale saved category that no longer exists in this context.
      const cats = m.map((x) => x.category).filter(Boolean) as string[]
      if (catFilter && !cats.includes(catFilter)) catFilter = ''
      startListPoll()
    } catch { matchesState = 'error' }
  }
  function changeCtx(v: Ctx) { ctx = v; catFilter = ''; dayFilter = ''; selected = null; reloadData() }

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
  <h1><img class="logo" src="icon.png" alt="" /> Fooseroo <span class="tag">Web</span></h1>

  {#if selected && view}
    <button class="ghost small back" onclick={closeMatch}>← Zurück</button>
    <div class="detail">
      {#if selected.running}<div class="live big"><span class="dot"></span> LIVE</div>{/if}
      <div class="hero">
        <div class="hname a">{#if !selected.running && selected.setsHome > selected.setsAway}{selected.homeName} ⭐{:else}{selected.homeName}{/if}</div>
        <div class="hsets">{selected.setsHome} : {selected.setsAway}</div>
        <div class="hname b">{#if !selected.running && selected.setsAway > selected.setsHome}⭐ {selected.awayName}{:else}{selected.awayName}{/if}</div>
      </div>
      <div class="meta center">{fmtDate(selected.at)}{#if selected.category} · {selected.category}{/if}</div>

      {#if progress && progress.rows.length}
        <MatchProgress rows={progress.rows} runningSetIndex={progress.runningSetIndex} />
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
          <span class="team home">{shared.homeName}{#if shared.setsHome > shared.setsAway} ⭐{/if}</span>
          <span class="sets">{shared.setsHome} : {shared.setsAway}</span>
          <span class="team">{#if shared.setsAway > shared.setsHome}⭐ {/if}{shared.awayName}</span>
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

    <div class="tabs">
      <button class="tab" class:active={tab === 'matches'} onclick={() => (tab = 'matches')}>⚪ Matches</button>
      <button class="tab" class:active={tab === 'training'} onclick={() => (tab = 'training')}>⏱️ Training</button>
    </div>

    <div class="filters">
      <select value={ctx ?? ''} onchange={(e) => changeCtx(e.currentTarget.value || null)}>
        <option value="">Dein Konto</option>
        {#each groups as g}<option value={g.id}>{g.name}</option>{/each}
      </select>
      {#if tab === 'matches'}
        <select bind:value={catFilter}>
          <option value="">Alle Kategorien</option>
          {#each categories as c}<option value={c}>{c}</option>{/each}
        </select>
      {/if}
      <select bind:value={dayFilter}>
        <option value="">Alle Tage</option>
        {#each days as d}<option value={d}>{dayLabel(d)}</option>{/each}
      </select>
    </div>

    {#if tab === 'matches'}
      {#if matchesState === 'loading'}
        <p class="hint">Lädt…</p>
      {:else if matchesState === 'error'}
        <p class="err">Matches konnten nicht geladen werden.</p>
      {:else if shownMatches.length === 0}
        <p class="hint">Keine Matches{#if catFilter || dayFilter} mit dieser Auswahl{/if} – erfasse welche in der App.</p>
      {:else}
        <ul class="list">
          {#each shownMatches as m}
            {@const w = winnerSide(m.setsHome, m.setsAway)}
            {@const mv = parseMatchState(m.state, m.running)}
            <li>
              <button class="card card-btn" onclick={() => openMatch(m)}>
                {#if m.running}<div class="live"><span class="dot"></span> LIVE</div>{/if}
                <div class="score">
                  <span class="team home">{m.homeName}{#if !m.running && w === 'home'} ⭐{/if}</span>
                  <span class="sets" class:running={m.running}>{m.setsHome} : {m.setsAway}</span>
                  <span class="team">{#if !m.running && w === 'away'}⭐ {/if}{m.awayName}</span>
                </div>
                <div class="metarow">
                  <span class="meta">{dayLabel(dayOf(m.at))}{#if m.category} · {m.category}{/if}</span>
                  {#if mv.sets.length || (m.running && mv.current)}
                    <span class="chips">
                      {#each mv.sets as s}<span class="setchip">{s.a}:{s.b}</span>{/each}
                      {#if m.running && mv.current}<span class="setchip cur">{mv.current.a}:{mv.current.b}</span>{/if}
                    </span>
                  {/if}
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      {#if matchesState === 'loading'}
        <p class="hint">Lädt…</p>
      {:else if shownTraining.length === 0}
        <p class="hint">Keine Trainingsergebnisse{#if dayFilter} an diesem Tag{/if}.</p>
      {:else}
        <ul class="list">
          {#each shownTraining.slice(0, 50) as t}
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
    {/if}

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
  /* App-matching palette (Material light + dark), exposed as global vars so the
     MatchProgress SVG inherits them too. Team A = blue, Team B = green, LIVE red. */
  :global(:root) {
    --bg: #E8F0FB;            /* app_background */
    --bg-deep: #CCDDF2;
    --surface: #FFFFFF;
    --surface-variant: #DEE3EC;
    --on-surface: #1A1C1E;
    --on-surface-variant: #44474E;
    --outline: #C4C6CF;
    --outline-variant: #C4C6CF;
    --team-a: #1565C0;        /* brand_primary  */
    --team-b: #2E7D32;        /* brand_secondary */
    --on-accent: #FFFFFF;
    --live: #E53935;          /* countdown_over */
    --ok: #2E7D32; --bad: #C62828;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #111418;
      --bg-deep: #0C0F12;
      --surface: #1A1F24;
      --surface-variant: #2A3038;
      --on-surface: #E2E2E6;
      --on-surface-variant: #C2C5CE;
      --outline: #3A3F46;
      --outline-variant: #43474E;
      --team-a: #A8C8FF;
      --team-b: #A5D6A7;
      --on-accent: #06210f;
      --live: #FF8A80;
      --ok: #A5D6A7; --bad: #FF8A80;
    }
  }
  :global(body) { margin: 0; font-family: system-ui, -apple-system, "Roboto", sans-serif;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
    background-attachment: fixed; color: var(--on-surface); }
  main { max-width: 440px; margin: 0 auto; padding: 28px 16px 40px;
    display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 26px; margin: 0 0 6px; display: flex; align-items: center; gap: 10px; }
  .logo { width: 30px; height: 30px; border-radius: 7px; }
  .tag { font-size: 12px; background: var(--surface-variant); color: var(--on-surface-variant);
    padding: 2px 8px; border-radius: 8px; vertical-align: middle; font-weight: 600; }
  p { margin: 0; line-height: 1.5; }
  .hint { color: var(--on-surface-variant); } .err { color: var(--bad); }
  input { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 16px; }
  button { padding: 12px 14px; border-radius: 12px; border: 0; background: var(--team-a);
    color: var(--on-accent); font-weight: 700; font-size: 16px; cursor: pointer; }
  button:disabled { opacity: .5; cursor: default; }
  button.ghost { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    font-weight: 600; }
  .ghost-link { color: var(--team-a); }
  .card { background: var(--surface); border: 1px solid var(--outline); border-radius: 16px;
    padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .meta { color: var(--on-surface-variant); font-size: 13px; }
  .score { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .team { flex: 1; font-weight: 600; }
  .team:last-child { text-align: right; }
  .team.home { text-align: right; }
  .sets { font-size: 18px; font-weight: 800; white-space: nowrap; }
  .sets.running { color: var(--team-a); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  button.small { padding: 6px 10px; font-size: 13px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }

  /* Matches / Training tabs — segmented control like the app's areas */
  .tabs { display: flex; gap: 6px; background: var(--surface-variant); padding: 4px;
    border-radius: 14px; }
  .tab { flex: 1; background: transparent; color: var(--on-surface-variant); font-weight: 700;
    font-size: 15px; padding: 9px 8px; border-radius: 10px; }
  .tab.active { background: var(--surface); color: var(--team-a);
    box-shadow: 0 1px 3px rgba(0,0,0,.12); }

  .filters { display: flex; flex-wrap: wrap; gap: 8px; }
  .filters select { flex: 1; min-width: 120px; padding: 10px; border-radius: 10px;
    border: 1px solid var(--outline); background: var(--surface); color: var(--on-surface);
    font-size: 14px; }
  .trow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; }
  .trow .meta { margin-left: 8px; }
  .tval { font-weight: 700; white-space: nowrap; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }

  /* clickable list cards */
  .card-btn { width: 100%; text-align: left; color: inherit; font: inherit; font-weight: 400;
    display: block; }
  .card-btn:active { background: var(--surface-variant); }

  /* live badge — red throbbing dot like LiveDotView */
  .live { display: inline-flex; align-items: center; gap: 6px; color: var(--live); font-weight: 700;
    font-size: 13px; letter-spacing: .12em; margin-bottom: 6px; }
  .live.big { font-size: 14px; justify-content: center; margin-bottom: 0; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: var(--live); display: inline-block;
    animation: pulse 1.5s infinite; }
  @keyframes pulse { 0% { transform: scale(1); opacity: 1 } 60% { transform: scale(1.45); opacity: .35 }
    100% { transform: scale(1); opacity: 1 } }

  /* match detail */
  .back { align-self: flex-start; }
  .center { text-align: center; }
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .hname { font-size: 22px; font-weight: 800; }
  .hname.a { color: var(--team-a); text-align: right; }
  .hname.b { color: var(--team-b); text-align: left; }
  .hsets { font-size: 44px; font-weight: 800; padding: 0 10px; line-height: 1; }
  .setchip { background: var(--surface-variant); color: var(--on-surface-variant);
    border-radius: 8px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
  .setchip.cur { background: transparent; border: 1.5px solid var(--live); color: var(--live); }
  /* match-tile meta line: date/category on the left, set chips on the right */
  .metarow { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin-top: 8px; flex-wrap: wrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
