<script lang="ts">
  import { onMount } from 'svelte'
  import { supabase } from './lib/supabase'
  import { requestCode, verifyCode } from './lib/auth'
  import { parseRoute, resolveSharedMatch, joinWithCode, groupInvitePreview,
    type SharedMatch, type Route, type InvitePreview } from './lib/shared'
  import { loadMatches, loadTraining, loadGroups, loadGroupRetention, loadCategories, winnerSide, formatElapsed,
    type MatchItem, type TrainingItem, type Group, type Ctx, type Retention } from './lib/data'
  import { parseMatchState, progressRows, setsWon } from './lib/match'
  import { watchLiveMatch, liveChannelId } from './lib/livematch'
  import { encodeMatch } from './lib/share'
  import { speak, cancelSpeech, speechSupported, acquireWakeLock, releaseWakeLock, reacquireWakeLockIfWanted } from './lib/live'
  import { matchStartLine, goalLine, currentScoreLine, setWinLines, correctionLine, finalLine, timeoutLine, recapLine } from './lib/commentary'
  import { applyTheme, getTheme, termsAccepted, onboardingShown } from './lib/prefs'
  import Onboarding from './lib/Onboarding.svelte'
  import Settings from './lib/Settings.svelte'
  import Account from './lib/Account.svelte'
  import MatchProgress from './lib/MatchProgress.svelte'
  import MatchEditor from './lib/MatchEditor.svelte'
  import CategoryEditor from './lib/CategoryEditor.svelte'
  import TrainingEntry from './lib/TrainingEntry.svelte'
  import TrainingChart from './lib/TrainingChart.svelte'
  import { isIOS } from './lib/platform'
  import { flip } from 'svelte/animate'
  import { fade } from 'svelte/transition'

  let route = $state<Route>({ type: 'home' })
  // First-run gate (terms must be accepted before the app is reachable) + settings.
  let gate = $state(false)
  let showMenu = $state(false)
  let showSettings = $state(false)
  let showAccount = $state(false)
  let showCtxMenu = $state(false)
  let showDatePicker = $state(false)
  let showCatPicker = $state(false)
  let showCatEditor = $state(false)
  let personFilter = $state('')        // training person report ('' = all people)
  let showPersonPicker = $state(false)
  let trainingEntry = $state(false)
  let signedIn = $state(false)
  // Web access requires entitlement: a paid Cloud-&-Sync plan (is_entitled) OR
  // membership in at least one training group. null = not yet checked.
  let entitled = $state<boolean | null>(null)
  let userEmail = $state<string | null>(null)
  let myUserId = $state<string | null>(null)
  // Match scoring editor (new / edit), overlay.
  let matchEditor = $state<{ mode: 'new' | 'edit'; initial: MatchItem | null } | null>(null)
  const defaultCategory = (typeof navigator !== 'undefined' && navigator.language?.startsWith('en')) ? 'Free play' : 'Freies Spiel'
  function onMatchSaved() { matchEditor = null; reloadData(true) }
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
  let cloudCategories = $state<string[]>([]) // synced category list (app_config), per context
  let training = $state<TrainingItem[]>([])

  // Context (Dein Konto / a group), category + day filters — like the app.
  let groups = $state<Group[]>([])
  let ctx = $state<Ctx>(null)
  const ctxLabel = $derived(ctx == null ? 'Dein Konto' : (groups.find((g) => g.id === ctx)?.name ?? 'Gruppe'))
  // Result-retention of the active group (null = off / personal context).
  let retention = $state<Retention | null>(null)
  // Join-a-group-by-code flow.
  let joinCode = $state('')
  let joinBusy = $state(false)
  let joinError = $state<'' | 'auth' | 'invalid' | 'throttled' | 'full' | 'error'>('')
  let pendingJoinCode = ''
  // Invite preview (group name + retention) shown before joining, like the app.
  let invitePreview = $state<InvitePreview | null>(null)
  let previewTimer: ReturnType<typeof setTimeout> | null = null

  // "Install as app" hint (Android/Chrome via beforeinstallprompt; iOS Safari is
  // manual, since it has no such event). Hidden once installed or dismissed.
  let showInstall = $state(false)
  let canInstall = $state(false)
  let installIOS = $state(false)
  let deferredPrompt: { prompt: () => void; userChoice: Promise<unknown> } | null = null
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  const installDismissed = () => { try { return localStorage.getItem('fs_install') === 'no' } catch { return false } }
  function dismissInstall() { showInstall = false; try { localStorage.setItem('fs_install', 'no') } catch { /* noop */ } }
  async function doInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try { await deferredPrompt.userChoice } catch { /* noop */ }
    deferredPrompt = null; canInstall = false; showInstall = false
  }
  let catFilter = $state<string>('')  // '' = all categories
  let dayFilter = $state<string>('')  // '' = all days; else a yyyy-mm-dd-ish key
  const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)
  // Merge the synced category list (app_config, incl. ones without a match yet, like
  // "Rangliste") with any categories present on loaded matches.
  const categories = $derived([...new Set([...cloudCategories, ...matches.map((m) => m.category).filter(Boolean)])] as string[])
  const days = $derived([...new Set(matches.map((m) => dayOf(m.at)))])
  // Player-name suggestions for the match editor (split team labels by " & ").
  const playerSuggestions = $derived([...new Set(
    matches.flatMap((m) => [m.homeName, m.awayName]).flatMap((l) => (l || '').split(' & '))
      .map((s) => s.trim()).filter((s) => s && s !== '–'))])
  // Training name + category suggestions (from existing entries).
  const trainingNames = $derived([...new Set(training.map((t) => t.name).filter(Boolean))] as string[])
  const trainingModes = $derived([...new Set(training.map((t) => t.mode).filter(Boolean))] as string[])
  // Counts shown in the date/category pickers (like the app): matches per day (all
  // categories) and per category on the selected day.
  const dayCount = (d: string) => matches.filter((m) => dayOf(m.at) === d).length
  const catCount = (c: string) => matches.filter((m) => m.category === c && dayOf(m.at) === dayFilter).length
  const shownMatches = $derived(matches.filter((m) =>
    (catFilter === '' || m.category === catFilter) && (dayFilter === '' || dayOf(m.at) === dayFilter)))
  const shownTraining = $derived(training.filter((t) =>
    (dayFilter === '' || dayOf(t.at) === dayFilter) && (personFilter === '' || t.name === personFilter)))

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

  // Read-aloud (Vorlesen) + wake lock for the live detail — the web counterparts of
  // the app's LiveCommentary control and its keep-screen-on-while-live behaviour.
  const speechOk = speechSupported()
  let readAloud = $state(false)
  try { readAloud = localStorage.getItem('fs_read') === '1' } catch { /* ignore */ }
  let announceBaseline = true
  let spokenGoals = 0, spokenSets = 0, spokenTimeouts = 0, spokenFinal = false
  let lastStateTs = 0 // ignore out-of-order live "state" pushes
  let swapAnim = $state(0) // bumped when a live update swaps the two sides → cross-slide
  function toggleRead() {
    readAloud = !readAloud
    try { localStorage.setItem('fs_read', readAloud ? '1' : '0') } catch { /* ignore */ }
    if (readAloud) announceBaseline = true; else cancelSpeech()
  }
  // Announce live updates as they arrive (diff vs. last spoken). Wording is a
  // byte-for-byte port of the app's LiveCommentaryService (lib/commentary.ts).
  $effect(() => {
    const v = view, on = readAloud, sel = selected
    // Read-aloud is ONLY for the (read-only) match detail of a live match — never
    // while editing. The editor view nulls `selected`, but guard explicitly too.
    if (!v || !on || !sel || matchEditor) return
    const n = { home: sel.homeName, away: sel.awayName }
    const run = !!sel.running
    const goals = v.goals.length, sets = v.sets.length, timeouts = v.timeouts.length

    // Read-aloud only applies to a RUNNING match (the toggle is shown only then).
    // Baseline ("Live A gegen B" + catch-up) is announced when read-aloud turns on
    // while live. Opening an ALREADY-finished match must stay silent — even though
    // readAloud is persisted on — so re-entering a finished game doesn't re-announce.
    if (run && announceBaseline) {
      spokenGoals = goals; spokenSets = sets; spokenTimeouts = timeouts
      announceBaseline = false; spokenFinal = false
      speak(matchStartLine(v, n))
      return
    }
    if (!run) {
      // "Endstand …" only on a genuine live→finished transition we were watching
      // (baseline already done). Not on a fresh open of a finished match
      // (announceBaseline still true → stays silent).
      if (!announceBaseline && !spokenFinal) { spokenFinal = true; speak(finalLine(v, n)) }
      return
    }
    // Undo/edit pulled counts back → "Korrektur." + recomputed set score, resync.
    if (goals < spokenGoals || sets < spokenSets || timeouts < spokenTimeouts) {
      spokenGoals = goals; spokenSets = sets; spokenTimeouts = timeouts
      speak(correctionLine(v, n))
      return
    }
    const newGoals = goals > spokenGoals, newSets = sets > spokenSets
    // Deciding goal is spoken before the set-win line (app event order).
    if (newGoals) for (let i = spokenGoals; i < goals; i++) speak(goalLine(v, n, i))
    if (timeouts > spokenTimeouts) {
      for (let i = spokenTimeouts; i < timeouts; i++) speak(timeoutLine(v, n, i))
      spokenTimeouts = timeouts
    }
    if (newSets) for (let i = spokenSets; i < sets; i++) {
      const [win, tally] = setWinLines(v, n, i)
      speak(win); speak(tally)
    }
    // The running set score follows a goal burst — but not when a set just closed
    // (that already ended with the tally; the new set would read 0 zu 0).
    if (newGoals && !newSets) speak(currentScoreLine(v, n))
    spokenGoals = goals; spokenSets = sets
  })

  // Read-aloud is detail-only: stop any ongoing speech the moment the editor opens.
  $effect(() => { if (matchEditor) cancelSpeech() })

  // Periodic recap ("Spielstand weiter …") every 3 minutes while live and reading,
  // like the app's RECAP_MILLIS. Keyed on a stable boolean so the per-poll `selected`
  // churn doesn't keep resetting the interval (which would stop it ever firing).
  const liveReading = $derived(readAloud && !!selected?.running)
  $effect(() => {
    if (!liveReading) return
    const id = setInterval(() => {
      const v = view, sel = selected
      if (v && sel?.running) speak(recapLine(v, { home: sel.homeName, away: sel.awayName }))
    }, 3 * 60 * 1000)
    return () => clearInterval(id)
  })

  // Realtime live view: while a running match is open, join its broadcast channel
  // as a read-only viewer (like the app), so each goal/timeout/set arrives instantly
  // instead of on the next poll. Keyed on derived primitives so per-poll `selected`
  // churn (reassignment with the same id) doesn't re-subscribe; the poll stays as a
  // fallback if realtime is down.
  const liveAt = $derived(selected?.running ? selected.at : null)
  const liveScope = $derived(selected?.running ? (ctx ?? myUserId) : null)
  $effect(() => {
    const at = liveAt, scope = liveScope
    if (at == null || !scope) return
    lastStateTs = 0
    const unsub = watchLiveMatch(liveChannelId(scope, at), {
      onState: (json, teamA, teamB, ts) => {
        if (ts != null && ts <= lastStateTs) return
        if (ts != null) lastStateTs = ts
        const cur = selected
        if (!cur) return
        try {
          const parsed = JSON.parse(json)
          const w = setsWon(parseMatchState(parsed, true))
          // The editor swapped sides → the two team names exchange. Trigger the
          // cross-slide (like the app's edit-view swap) instead of a hard jump.
          if (teamA && teamB && teamA === cur.awayName && teamB === cur.homeName && teamA !== teamB) swapAnim++
          selected = { ...cur, state: parsed, running: true, setsHome: w.a, setsAway: w.b,
            homeName: teamA ?? cur.homeName, awayName: teamB ?? cur.awayName }
        } catch { /* ignore malformed push */ }
      },
      onEnded: (finalJson, abandoned) => {
        const cur = selected
        if (!cur) return
        if (abandoned) {
          spokenFinal = true // discarded → no "Endstand"
          selected = { ...cur, running: false }
        } else {
          try {
            const parsed = finalJson ? JSON.parse(finalJson) : cur.state
            const w = setsWon(parseMatchState(parsed, false))
            selected = { ...cur, state: parsed, running: false, setsHome: w.a, setsAway: w.b }
          } catch { selected = { ...cur, running: false } }
        }
        stopPoll()
      }
    })
    return () => unsub()
  })
  // Keep the screen awake while a live match detail is open (like the app).
  $effect(() => {
    if (selected?.running) acquireWakeLock(); else releaseWakeLock()
  })

  // Match-detail URL while viewing: keep it IN the PWA scope (…/app/#/m/<token>).
  // A path like fooseroo.app/m/<token> is OUTSIDE the manifest scope (./ → /app/),
  // which makes iOS standalone (and installed desktop PWAs) drop their chrome back
  // in (title/toolbar with back/share/reload). The hash form is exactly what
  // parseRoute reads, so a reload restores the detail directly. The canonical,
  // App-Link-capable share link (fooseroo.app/m/<token>) is produced only by the
  // explicit "Teilen" action below.
  let appBase = '/'
  const shareBase = () => appBase.replace(/app\/?$/, '')
  function setMatchUrl(token: string) {
    try { history.replaceState(null, '', `${appBase}#/m/${token}`) } catch { /* noop */ }
  }
  // Canonical absolute share URL (App-Link path form) for a group match.
  function shareUrlFor(token: string) {
    return `${location.origin}${shareBase()}m/${token}`
  }
  let shareNote = $state('')
  let shareNoteTimer: ReturnType<typeof setTimeout> | null = null
  async function shareMatch() {
    if (!ctx || !selected) return
    const url = shareUrlFor(encodeMatch(ctx, selected.at))
    if (navigator.share) {
      try { await navigator.share({ title: `${selected.homeName} : ${selected.awayName}`, url }) }
      catch { /* user cancelled */ }
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      shareNote = 'Link kopiert'
    } catch { shareNote = url }
    if (shareNoteTimer) clearTimeout(shareNoteTimer)
    shareNoteTimer = setTimeout(() => { shareNote = '' }, 2500)
  }
  function writeHomeUrl() {
    const q = new URLSearchParams()
    q.set('tab', tab)
    if (ctx) q.set('ctx', ctx)
    if (catFilter) q.set('cat', catFilter)
    if (dayFilter) q.set('day', dayFilter)
    try { history.replaceState(null, '', `${appBase}?${q.toString()}`) } catch { /* noop */ }
  }

  function openMatch(m: MatchItem) {
    selected = m
    announceBaseline = true; spokenGoals = 0; spokenSets = 0; spokenTimeouts = 0; spokenFinal = false; swapAnim = 0
    stopPoll(); stopListPoll()
    // Group matches are shareable → reflect the token in the URL so the link opens
    // the app and a reload keeps showing this detail. (Personal matches have no
    // shareable identity, so their URL stays the home URL.)
    if (ctx) setMatchUrl(encodeMatch(ctx, m.at))
    // Always poll while the detail is open, so a change or a switch to LIVE is
    // picked up even if the match wasn't running when opened (faster while live).
    pollTimer = setInterval(refreshSelected, m.running ? 3000 : 6000)
  }
  function closeMatch() {
    stopPoll(); cancelSpeech(); selected = null
    route = { type: 'home' }
    writeHomeUrl()
    startListPoll()
  }

  // While the list is open (signed-in home, no detail), poll so new/changed/live
  // matches appear without a manual reload.
  let listTimer: ReturnType<typeof setInterval> | null = null
  function startListPoll() {
    stopListPoll()
    if (signedIn && route.type === 'home' && !selected)
      // Silent refresh: update in place without the loading flash, so the list
      // doesn't flicker — only changed rows re-render (keyed + animated below).
      listTimer = setInterval(() => { if (!selected) reloadData(true) }, 6000)
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
  const fmtTime = (at: number) =>
    new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

  const joinErrorText = (e: string) =>
    e === 'invalid' ? 'Code ungültig, deaktiviert oder abgelaufen.'
    : e === 'throttled' ? 'Zu viele Versuche – bitte später erneut.'
    : e === 'full' ? 'Diese Gruppe ist voll.'
    : 'Beitritt fehlgeschlagen – bitte erneut versuchen.'

  onMount(() => {
    applyTheme(getTheme())
    gate = !termsAccepted() || !onboardingShown()
    appBase = location.pathname.replace(/[^/]*$/, '')   // e.g. "/app/" (SPA base)
    route = parseRoute(location.hash)
    if (route.type === 'join') joinCode = route.code
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
    addEventListener('hashchange', () => {
      route = parseRoute(location.hash)
      if (route.type === 'join') { joinCode = route.code; joinError = '' }
      maybeResolve()
    })
    supabase.auth.getSession().then(({ data }) => {
      signedIn = !!data.session; userEmail = data.session?.user.email ?? null
      myUserId = data.session?.user.id ?? null
      ready = true; maybeResolve()
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      signedIn = !!session; userEmail = session?.user.email ?? null
      myUserId = session?.user.id ?? null
      if (session) { step = 'email'; code = '' } else { entitled = null }
      maybeResolve()
      // Resume a join the user started before signing in.
      if (session && pendingJoinCode) { const c = pendingJoinCode; pendingJoinCode = ''; attemptJoin(c) }
    })
    // Install-as-app hint.
    if (!isStandalone() && !installDismissed()) {
      installIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
      if (installIOS) showInstall = true // iOS Safari has no install event → manual hint
    }
    const onBip = (e: Event) => {
      e.preventDefault()
      deferredPrompt = e as unknown as { prompt: () => void; userChoice: Promise<unknown> }
      canInstall = true
      if (!isStandalone() && !installDismissed()) showInstall = true
    }
    addEventListener('beforeinstallprompt', onBip)
    const onInstalled = () => { showInstall = false; canInstall = false }
    addEventListener('appinstalled', onInstalled)
    // Wake locks drop while the tab is hidden — re-acquire when visible again.
    const onVis = () => reacquireWakeLockIfWanted()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      sub.subscription.unsubscribe()
      removeEventListener('beforeinstallprompt', onBip)
      removeEventListener('appinstalled', onInstalled)
      document.removeEventListener('visibilitychange', onVis)
      releaseWakeLock()
    }
  })

  // Persist the selection and mirror it live into the URL (tab/ctx/cat/day), so a
  // reload or shared link restores the same view.
  $effect(() => {
    const t = tab, c = ctx, cat = catFilter, day = dayFilter
    persist()
    // While a match detail (or the join view) is shown, its own URL is in charge —
    // don't overwrite it with the home/list URL.
    if (selected || route.type === 'match' || route.type === 'join') return
    const q = new URLSearchParams()
    q.set('tab', t)
    if (c) q.set('ctx', c)
    if (cat) q.set('cat', cat)
    if (day) q.set('day', day)
    history.replaceState(null, '', `${appBase}?${q.toString()}`)
  })

  // Entitled = paid Cloud-&-Sync plan (is_entitled RPC: allowlist or active sub) OR
  // member of ≥1 training group. Loads groups in the same pass.
  async function checkEntitlement(): Promise<boolean> {
    try {
      const [entRes, gs] = await Promise.all([
        supabase.rpc('is_entitled'),
        loadGroups().catch(() => [] as Group[])
      ])
      groups = gs
      entitled = entRes.data === true || gs.length > 0
    } catch {
      entitled = false
    }
    return entitled === true
  }

  async function maybeResolve() {
    if (route.type === 'match' && signedIn) {
      sharedState = 'loading'; shared = null
      const r = await resolveSharedMatch(route.token)
      if (r.status === 'ok') {
        shared = r.data; sharedState = 'idle'
        // Open the FULL detail (same rich view as tapping a card), normalize the
        // URL to the clean token path, and load the group's list so "Zurück" lands
        // on it. Poll if the match is live.
        ctx = r.data.groupId
        selected = {
          homeName: r.data.homeName, awayName: r.data.awayName,
          setsHome: r.data.setsHome, setsAway: r.data.setsAway,
          category: r.data.category, at: r.data.at, state: r.data.state, running: r.data.running
        }
        setMatchUrl(route.token)
        stopPoll(); stopListPoll()
        if (r.data.running) pollTimer = setInterval(refreshSelected, 3000)
        if (groups.length === 0) loadGroups().then((g) => { groups = g }).catch(() => {})
        reloadData(true)
      } else sharedState = r.status === 'auth' ? 'idle' : r.status
    } else if (route.type === 'home' && signedIn) {
      const ok = await checkEntitlement()
      if (ok) await reloadData()
    }
  }

  // silent = background poll: don't flash the loading state (avoids flicker); the
  // list updates in place and only changed rows re-render (keyed + animated).
  async function reloadData(silent = false) {
    if (!silent) matchesState = 'loading'
    try {
      const [m, t, cloudCats] = await Promise.all([loadMatches(ctx), loadTraining(ctx), loadCategories(ctx)])
      matches = m; training = t; cloudCategories = cloudCats; matchesState = 'idle'
      // Pre-select the newest day that has a match (in any category) unless the
      // current day is still valid (e.g. from the URL or a manual pick this session).
      const mdays = [...new Set(m.map((x) => dayOf(x.at)))]
      if (!dayFilter || !mdays.includes(dayFilter)) dayFilter = newestMatchDay(m)
      // A category is always selected (like the app — no "all categories"). Keep a
      // valid saved/URL pick, else default to the newest match's category.
      const cats = m.map((x) => x.category).filter(Boolean) as string[]
      if (!catFilter || !cats.includes(catFilter))
        catFilter = (m.find((x) => x.category)?.category) ?? cats[0] ?? ''
      startListPoll()
      // Result-retention notice for the active group (best-effort, non-blocking).
      if (ctx) loadGroupRetention(ctx).then((r) => { retention = r }).catch(() => {})
      else retention = null
    } catch { if (!silent) matchesState = 'error' }
  }
  function changeCtx(v: Ctx) { ctx = v; catFilter = ''; dayFilter = ''; selected = null; retention = null; reloadData() }

  // After leaving a group (in the Account dialog): reload memberships, and if the
  // active context was that group, fall back to "Dein Konto".
  async function refreshGroupsAfterChange() {
    groups = await loadGroups().catch(() => groups)
    if (ctx && !groups.some((g) => g.id === ctx)) changeCtx(null)
    if (groups.length === 0) {
      // No groups left → web access only via a paid plan; re-check entitlement.
      entitled = await checkEntitlement().catch(() => entitled)
    }
  }

  // Leave the join view and return to the home list (works whether the join view
  // was opened via the in-app button or a #/g/<code> deep link).
  function goHome() {
    joinError = ''; joinCode = ''; pendingJoinCode = ''
    route = { type: 'home' }
    try { history.replaceState(null, '', `${location.pathname}${location.search}`) } catch { /* noop */ }
    maybeResolve()
  }

  // Debounced invite preview while on the join route: resolve the code to the
  // group's name + retention (no join, works signed-out) so the user sees what
  // they're joining — identical to the app's invite.
  $effect(() => {
    const onJoin = route.type === 'join'
    const code = joinCode
    if (previewTimer) clearTimeout(previewTimer)
    if (!onJoin) { invitePreview = null; return }
    previewTimer = setTimeout(async () => {
      const c = code.trim()
      if (c.replace(/[^0-9A-Za-z]/g, '').length < 6) { invitePreview = null; return }
      invitePreview = await groupInvitePreview(c)
    }, 300)
  })

  // Already a member + signed in → just switch to that group, skip the join step.
  // Reactive to `groups` too, so it still fires if memberships load after the
  // preview resolved. Matches by the group id from group_invite_preview (reliable).
  $effect(() => {
    if (route.type !== 'join' || !signedIn || !invitePreview?.id) return
    const id = invitePreview.id
    const mine = groups.find((g) => g.id === id)
    if (!mine) return
    invitePreview = null; joinCode = ''; route = { type: 'home' }
    try { history.replaceState(null, '', `${location.pathname}${location.search}`) } catch { /* noop */ }
    changeCtx(mine.id)
  })

  // Join a training group by its short code (server-throttled). Requires sign-in;
  // if signed out, remembers the code and retries right after authentication.
  async function attemptJoin(raw: string) {
    const c = raw.trim()
    if (!c) return
    joinBusy = true; joinError = ''
    const r = await joinWithCode(c)
    joinBusy = false
    if (r.status === 'ok') {
      groups = await loadGroups().catch(() => groups)
      entitled = true   // membership in a group grants web access
      ctx = r.groupId; catFilter = ''; dayFilter = ''; tab = 'matches'
      joinCode = ''; route = { type: 'home' }
      try { history.replaceState(null, '', `${location.pathname}${location.search}`) } catch { /* noop */ }
      await reloadData()
    } else if (r.status === 'auth') {
      pendingJoinCode = c; joinError = 'auth'
    } else {
      joinError = r.status
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

  const needsAuthForShare = $derived(route.type !== 'home' && !signedIn)
</script>

<main>
  <div class="topbar">
    <h1><img class="logo" src="icon.png" alt="" /> <span class="brand">Fooseroo</span> <span class="tag">Web</span></h1>
    <div class="topright">
      {#if signedIn && entitled}
        <div class="ctxwrap">
          <button class="ctxchip" aria-haspopup="menu" onclick={() => (showCtxMenu = !showCtxMenu)}>
            {ctxLabel} <span class="caret">▾</span>
          </button>
          {#if showCtxMenu}
            <button class="menu-catch" class:dim={isIOS} aria-label="Schließen" onclick={() => (showCtxMenu = false)}></button>
            <div class="menu" class:sheet={isIOS} role="menu">
              <button role="menuitem" class:sel={ctx == null} onclick={() => { showCtxMenu = false; changeCtx(null) }}>{ctx == null ? '✓ ' : ''}Dein Konto</button>
              {#each groups as g}
                <button role="menuitem" class:sel={ctx === g.id} onclick={() => { showCtxMenu = false; changeCtx(g.id) }}>{ctx === g.id ? '✓ ' : ''}{g.name}</button>
              {/each}
              <div class="menu-sep"></div>
              <button role="menuitem" onclick={() => { showCtxMenu = false; showAccount = true }}>Konto &amp; Sync</button>
            </div>
          {/if}
        </div>
      {/if}
      <div class="menuwrap">
        <button class="iconbtn" aria-label="Menü" aria-haspopup="menu" onclick={() => (showMenu = !showMenu)}>
          {#if isIOS}
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          {/if}
        </button>
        {#if showMenu}
          <button class="menu-catch" class:dim={isIOS} aria-label="Menü schließen" onclick={() => (showMenu = false)}></button>
          <div class="menu" class:sheet={isIOS} role="menu">
            <button role="menuitem" onclick={() => { showMenu = false; showAccount = true }}>Konto &amp; Sync</button>
            <button role="menuitem" onclick={() => { showMenu = false; showSettings = true }}>Einstellungen</button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if showInstall}
    <div class="install">
      {#if canInstall}
        <span>Fooseroo Web als App installieren?</span>
        <span class="rowbtns">
          <button class="ghost small" onclick={doInstall}>Installieren</button>
          <button class="ghost small" onclick={dismissInstall}>Später</button>
        </span>
      {:else if installIOS}
        <span>Installieren: unten auf <strong>Teilen</strong> tippen, dann <strong>„Zum Home-Bildschirm"</strong>.</span>
        <button class="ghost small" onclick={dismissInstall}>OK</button>
      {/if}
    </div>
  {/if}

  {#if selected && view}
    <div class="detail-top">
      <button class="ghost small back" onclick={closeMatch}>{isIOS ? '‹' : '←'} Zurück</button>
      <div class="dt-right">
        {#if ctx}<button class="ghost small share" onclick={shareMatch}>Teilen</button>{/if}
        <button class="ghost small" onclick={() => { const m = selected; closeMatch(); matchEditor = { mode: 'edit', initial: m } }}>Bearbeiten</button>
      </div>
    </div>
    {#if shareNote}<div class="share-note">{shareNote}</div>{/if}
    <div class="detail">
      {#if selected.running}<div class="live big"><span class="dot"></span> LIVE</div>{/if}
      <!-- Keyed on swapAnim so a live side-swap re-mounts the hero and replays the
           cross-slide (like the app's edit-view swap); no animation on first open. -->
      {#key swapAnim}
        <div class="hero" class:swap-anim={swapAnim > 0}>
          <div class="hname a">{#if !selected.running && selected.setsHome > selected.setsAway}{selected.homeName} ⭐{:else}{selected.homeName}{/if}</div>
          <div class="hsets">{selected.setsHome} : {selected.setsAway}</div>
          <div class="hname b">{#if !selected.running && selected.setsAway > selected.setsHome}⭐ {selected.awayName}{:else}{selected.awayName}{/if}</div>
        </div>
      {/key}
      <div class="meta center">{fmtDate(selected.at)}{#if selected.category} · {selected.category}{/if}</div>

      {#if selected.running && speechOk}
        <button class="readbtn" class:on={readAloud} aria-pressed={readAloud} onclick={toggleRead}>
          {readAloud ? '🔊  Vorlesen: an' : '🔈  Vorlesen: aus'}
        </button>
      {/if}

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

  {:else if route.type === 'join'}
    <h2 class="jointitle">Gruppe beitreten</h2>
    {#if invitePreview}
      <div class="card invite">
        <p>Du wurdest in die Trainingsgruppe <strong>{invitePreview.name}</strong> eingeladen.</p>
        {#if invitePreview.retentionDays}
          <p class="retention">🛡️ Ergebnisse in dieser Trainingsgruppe werden nach {invitePreview.retentionDays} Tagen automatisch gelöscht.</p>
        {/if}
      </div>
    {/if}
    {#if !signedIn}
      <p class="hint">Melde dich an, um {invitePreview ? `der Gruppe „${invitePreview.name}" beizutreten` : 'einer Trainingsgruppe beizutreten'}.</p>
      {@render authForm()}
      <button class="ghost small" onclick={goHome}>Abbrechen</button>
    {:else}
      {#if !invitePreview}
        <p class="hint">Gib den Beitritts-Code ein, den du erhalten hast.</p>
      {/if}
      <input bind:value={joinCode} placeholder="Code (z. B. K7QF-3MZP)" autocomplete="off"
             autocapitalize="characters"
             onkeydown={(e) => { if (e.key === 'Enter' && !joinBusy && joinCode.trim()) attemptJoin(joinCode) }} />
      <button onclick={() => attemptJoin(joinCode)} disabled={joinBusy || !joinCode.trim()}>
        {joinBusy ? 'Trete bei…' : invitePreview ? `„${invitePreview.name}" beitreten` : 'Beitreten'}
      </button>
      {#if joinError && joinError !== 'auth'}<p class="err">{joinErrorText(joinError)}</p>{/if}
      <button class="ghost small" onclick={goHome}>Abbrechen</button>
    {/if}

  {:else if signedIn}
    {#if entitled === null}
      <p class="hint">Lädt…</p>
    {:else if !entitled}
      <div class="card gateinfo">
        <p>Die Funktionen der Web-Variante stehen zur Verfügung, wenn du <strong>Mitglied einer Trainingsgruppe</strong> bist oder über die <strong>Android-App einen „Cloud &amp; Sync"-Tarif</strong> hast.</p>
        <p class="hint">Tritt einer Trainingsgruppe per Code bei, oder richte „Cloud &amp; Sync" in der Android-App ein — danach erscheinen deine Inhalte hier automatisch.</p>
        <div class="gatebtns">
          <button onclick={() => { route = { type: 'join', code: '' }; joinCode = ''; joinError = '' }}>Gruppe beitreten</button>
          <a class="ghost-link" href="https://play.google.com/store/apps/details?id=de.snickel.fooser" target="_blank" rel="noopener">Android-App</a>
        </div>
      </div>
    {:else}
    <div class="filters">
      <div class="fchipwrap">
        <button class="fchip" aria-haspopup="menu" onclick={() => (showDatePicker = !showDatePicker)}>
          <svg class="fci" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/></svg>
          <span class="fct">{dayLabel(dayFilter)}{dayCount(dayFilter) ? ` (${dayCount(dayFilter)})` : ''}</span>
          <span class="caret">▾</span>
        </button>
        {#if showDatePicker}
          <button class="menu-catch" aria-label="Schließen" onclick={() => (showDatePicker = false)}></button>
          <div class="menu picker" role="menu">
            {#each days as d}
              <button role="menuitem" class:sel={d === dayFilter} onclick={() => { showDatePicker = false; dayFilter = d }}>
                <span>{d === dayFilter ? '✓ ' : ''}{dayLabel(d)}</span><span class="cnt">{dayCount(d)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if tab === 'matches'}
        <div class="fchipwrap">
          <button class="fchip" aria-haspopup="menu" onclick={() => (showCatPicker = !showCatPicker)}>
            <svg class="fci" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.41 11.58l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 .59 1.42l9 9a2 2 0 0 0 2.82 0l7-7a2 2 0 0 0 0-2.84zM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8z"/></svg>
            <span class="fct">{catFilter || 'Kategorie'}</span>
            <span class="caret">▾</span>
          </button>
          {#if showCatPicker}
            <button class="menu-catch" aria-label="Schließen" onclick={() => (showCatPicker = false)}></button>
            <div class="menu picker" role="menu">
              {#each categories as c}
                <button role="menuitem" class:sel={c === catFilter} onclick={() => { showCatPicker = false; catFilter = c }}>
                  <span>{c === catFilter ? '✓ ' : ''}{c}</span><span class="cnt">{catCount(c)}</span>
                </button>
              {/each}
              <div class="menu-sep"></div>
              <button role="menuitem" onclick={() => { showCatPicker = false; showCatEditor = true }}>✎ Kategorien verwalten</button>
            </div>
          {/if}
        </div>
      {:else}
        <!-- Training: person filter → per-person report (with "alle Tage" = cross-day). -->
        <div class="fchipwrap">
          <button class="fchip" aria-haspopup="menu" onclick={() => (showPersonPicker = !showPersonPicker)}>
            <svg class="fci" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>
            <span class="fct">{personFilter || 'Alle Personen'}</span>
            <span class="caret">▾</span>
          </button>
          {#if showPersonPicker}
            <button class="menu-catch" aria-label="Schließen" onclick={() => (showPersonPicker = false)}></button>
            <div class="menu picker" role="menu">
              <button role="menuitem" class:sel={personFilter === ''} onclick={() => { showPersonPicker = false; personFilter = '' }}>{personFilter === '' ? '✓ ' : ''}Alle Personen</button>
              {#each trainingNames as n}
                <button role="menuitem" class:sel={n === personFilter} onclick={() => { showPersonPicker = false; personFilter = n }}>{n === personFilter ? '✓ ' : ''}{n}</button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    {#if retention}
      <p class="retention">🛡️ Ergebnisse in dieser Trainingsgruppe werden nach {retention.days} Tagen automatisch gelöscht.</p>
    {/if}

    {#if tab === 'matches'}
      <button class="newmatch" onclick={() => (matchEditor = { mode: 'new', initial: null })}>＋ Neues Match</button>
      {#if matchesState === 'loading'}
        <p class="hint">Lädt…</p>
      {:else if matchesState === 'error'}
        <p class="err">Matches konnten nicht geladen werden.</p>
      {:else if shownMatches.length === 0}
        <p class="hint">Keine Matches{#if catFilter || dayFilter} mit dieser Auswahl{/if} – erfasse welche in der App.</p>
      {:else}
        <ul class="list">
          {#each shownMatches as m (m.at)}
            {@const w = winnerSide(m.setsHome, m.setsAway)}
            {@const mv = parseMatchState(m.state, m.running)}
            <li animate:flip={{ duration: 220 }} in:fade={{ duration: 160 }}>
              <button class="card card-btn" onclick={() => openMatch(m)}>
                {#if m.running}<div class="live"><span class="dot"></span> LIVE</div>{/if}
                <div class="score">
                  <span class="team home">{m.homeName}{#if !m.running && w === 'home'} ⭐{/if}</span>
                  <span class="sets" class:running={m.running}>{m.setsHome} : {m.setsAway}</span>
                  <span class="team">{#if !m.running && w === 'away'}⭐ {/if}{m.awayName}</span>
                </div>
                <div class="metarow">
                  <span class="meta">{fmtTime(m.at)}</span>
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
      <button class="newmatch" onclick={() => (trainingEntry = true)}>＋ Neuer Trainingseintrag</button>
      {#if matchesState === 'loading'}
        <p class="hint">Lädt…</p>
      {:else if shownTraining.length === 0}
        <p class="hint">Keine Trainingsergebnisse{#if dayFilter} an diesem Tag{/if}.</p>
      {:else}
        <TrainingChart items={shownTraining} />
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
    {/if}

  {:else}
    <p>Melde dich an, um deine Matches &amp; Trainings (und geteilte Inhalte) hier zu sehen.</p>
    {@render authForm()}
  {/if}
</main>

{#if gate}
  <Onboarding onDone={() => (gate = false)} />
{/if}
{#if showSettings}
  <Settings onClose={() => (showSettings = false)} />
{/if}
{#if showAccount}
  <Account {signedIn} {userEmail} {groups} {myUserId} onClose={() => (showAccount = false)}
           onJoin={() => { route = { type: 'join', code: '' }; joinCode = ''; joinError = '' }}
           onGroupsChanged={refreshGroupsAfterChange} />
{/if}
{#if matchEditor}
  <MatchEditor mode={matchEditor.mode} {ctx} {myUserId} initial={matchEditor.initial}
               nameSuggestions={playerSuggestions} categorySuggestions={categories} {defaultCategory}
               onClose={() => (matchEditor = null)} onSaved={onMatchSaved} />
{/if}
{#if showCatEditor}
  <CategoryEditor {ctx} {categories} {defaultCategory}
                  onClose={() => (showCatEditor = false)} onChanged={() => reloadData(true)} />
{/if}
{#if trainingEntry}
  <TrainingEntry {ctx} nameSuggestions={trainingNames.length ? trainingNames : playerSuggestions}
                 modeSuggestions={trainingModes}
                 onClose={() => (trainingEntry = false)} onSaved={() => reloadData(true)} />
{/if}

<!-- Bottom navigation between Matches & Training — like the native app (the Liga
     area is intentionally absent from the web version). Icons mirror the app's
     ic_matches_24 (plain foosball ring) and ic_mode_24 (history). -->
{#if signedIn && route.type === 'home' && !selected}
  <nav class="bottomnav">
    <button class="navitem" class:active={tab === 'matches'} onclick={() => (tab = 'matches')} aria-label="Matches">
      <span class="naicon"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12,2C6.48,2 2,6.48 2,12s4.48,10 10,10 10,-4.48 10,-10S17.52,2 12,2zM12,20c-4.41,0 -8,-3.59 -8,-8s3.59,-8 8,-8 8,3.59 8,8 -3.59,8 -8,8z"/></svg></span>
      <span class="nalabel">Matches</span>
    </button>
    <button class="navitem" class:active={tab === 'training'} onclick={() => (tab = 'training')} aria-label="Training">
      <span class="naicon"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.26,3C8.17,2.86 4,6.95 4,12L2.21,12c-0.45,0 -0.67,0.54 -0.35,0.85l2.79,2.8c0.2,0.2 0.51,0.2 0.71,0l2.79,-2.8c0.31,-0.31 0.09,-0.85 -0.36,-0.85L6,12c0,-3.9 3.18,-7.05 7.1,-7 3.72,0.05 6.85,3.18 6.9,6.9 0.05,3.91 -3.1,7.1 -7,7.1 -1.61,0 -3.1,-0.55 -4.28,-1.48 -0.4,-0.31 -0.96,-0.28 -1.32,0.08 -0.42,0.42 -0.39,1.13 0.08,1.49C9,20.29 10.91,21 13,21c5.05,0 9.14,-4.17 9,-9.26 -0.13,-4.69 -4.05,-8.61 -8.74,-8.74zM12.75,8c-0.41,0 -0.75,0.34 -0.75,0.75v3.68c0,0.35 0.19,0.68 0.49,0.86l3.12,1.85c0.36,0.21 0.82,0.09 1.03,-0.26 0.21,-0.36 0.09,-0.82 -0.26,-1.03l-2.88,-1.71v-3.4c0,-0.4 -0.34,-0.74 -0.75,-0.74z"/></svg></span>
      <span class="nalabel">Training</span>
    </button>
  </nav>
{/if}

{#snippet authForm()}
  {#if step === 'email'}
    <input type="email" inputmode="email" autocomplete="email"
           bind:value={email} placeholder="E-Mail-Adresse"
           onkeydown={(e) => { if (e.key === 'Enter' && !busy && email.includes('@')) send() }} />
    <button onclick={send} disabled={busy || !email.includes('@')}>Code per E-Mail senden</button>
  {:else}
    <p class="hint">Code aus der E-Mail an <strong>{email}</strong>:</p>
    <p class="hint subtle">Gib den 6-stelligen Code direkt hier ein. Tippe <strong>nicht</strong> auf den Link in der E-Mail – er öffnet den Browser, nicht diese App.</p>
    <input inputmode="numeric" autocomplete="one-time-code" bind:value={code} placeholder="Code"
           onkeydown={(e) => { if (e.key === 'Enter' && !busy && code.trim()) verify() }} />
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
  /* Dark palette: on system-dark unless the user forced "Hell", and always when the
     user forced "Dunkel" (Settings → Design). */
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme="light"])) {
      --bg: #111418; --bg-deep: #0C0F12; --surface: #1A1F24; --surface-variant: #2A3038;
      --on-surface: #E2E2E6; --on-surface-variant: #C2C5CE; --outline: #3A3F46;
      --outline-variant: #43474E; --team-a: #A8C8FF; --team-b: #A5D6A7; --on-accent: #06210f;
      --live: #FF8A80; --ok: #A5D6A7; --bad: #FF8A80;
    }
  }
  :global(:root[data-theme="dark"]) {
    --bg: #111418; --bg-deep: #0C0F12; --surface: #1A1F24; --surface-variant: #2A3038;
    --on-surface: #E2E2E6; --on-surface-variant: #C2C5CE; --outline: #3A3F46;
    --outline-variant: #43474E; --team-a: #A8C8FF; --team-b: #A5D6A7; --on-accent: #06210f;
    --live: #FF8A80; --ok: #A5D6A7; --bad: #FF8A80;
  }
  /* The page background covers the whole screen incl. behind the status bar. The
     solid top colour on <html> matches the status bar theme-color exactly, so there
     is no seam/line; the body carries the subtle gradient (no fixed attachment,
     which caused a visible band at the safe-area edge). */
  :global(html) { background: var(--bg); }
  :global(body) { margin: 0; font-family: system-ui, -apple-system, "Roboto", sans-serif;
    min-height: 100vh;
    background: linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
    color: var(--on-surface); }
  main { max-width: 440px; margin: 0 auto;
    padding: 0 16px 96px;   /* top spacing comes from the sticky .topbar below */
    display: flex; flex-direction: column; gap: 14px; }
  /* Logo + wordmark like the app's branding: large round logo, "Fooseroo" bold in
     the brand blue, same family/colour, similar position. */
  h1 { font-size: 32px; margin: 0 0 4px; display: flex; align-items: center; gap: 12px; }
  .logo { width: 48px; height: 48px; border-radius: 50%; }
  .brand { color: var(--team-a); font-weight: 800; letter-spacing: -.3px; }
  /* Top bar with the three-dot overflow menu (top-right), like the app. Sticky at the
     top (like the fixed bottom nav) with a solid background incl. the status-bar
     safe area, so it stays put and content scrolls UNDER it instead of past it. */
  .topbar { position: sticky; top: 0; z-index: 40; background: var(--bg);
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 0 -16px; padding: calc(6px + env(safe-area-inset-top, 0px)) 16px 10px; }
  .menuwrap { position: relative; flex: 0 0 auto; }
  .iconbtn { background: transparent; border: 0; padding: 6px; cursor: pointer;
    color: var(--on-surface-variant); border-radius: 50%; display: inline-flex; }
  .iconbtn svg { width: 24px; height: 24px; fill: currentColor; }
  .iconbtn:active { background: var(--surface-variant); }
  .menu-catch { position: fixed; inset: 0; z-index: 60; background: transparent; border: 0; padding: 0; }
  .menu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 61; background: var(--surface);
    border: 1px solid var(--outline); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
    min-width: 184px; overflow: hidden; }
  .menu button { display: block; width: 100%; text-align: left; background: transparent; border: 0;
    padding: 12px 16px; font-size: 15px; color: var(--on-surface); cursor: pointer; }
  .menu button:active { background: var(--surface-variant); }
  .menu button.sel { color: var(--team-a); font-weight: 700; }
  /* iOS: render dropdowns as a bottom action sheet with a dimmed backdrop. */
  .menu-catch.dim { background: rgba(0,0,0,.35); }
  .menu.sheet { position: fixed; left: 0; right: 0; bottom: 0; top: auto; margin: 0 auto;
    width: 100%; max-width: 440px; min-width: 0; border-radius: 16px 16px 0 0;
    padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px)); }
  .menu.sheet button { text-align: center; padding: 16px; font-size: 17px; }
  .menu-sep { height: 1px; background: var(--outline); margin: 4px 0; }
  /* Right side of the top bar: context chip ("Dein Konto ▾") + three-dot menu. */
  .topright { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .ctxwrap { position: relative; }
  .ctxchip { background: var(--surface); border: 1px solid var(--outline); border-radius: 999px;
    padding: 7px 12px; font-size: 14px; font-weight: 600; color: var(--on-surface); cursor: pointer;
    max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 4px; }
  .ctxchip .caret { color: var(--on-surface-variant); }
  .tag { font-size: 12px; background: var(--surface-variant); color: var(--on-surface-variant);
    padding: 2px 8px; border-radius: 8px; vertical-align: middle; font-weight: 600; }
  p { margin: 0; line-height: 1.5; }
  .hint { color: var(--on-surface-variant); } .err { color: var(--bad); }
  .hint.subtle { font-size: 13px; margin-top: -4px; }
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
  .score { display: flex; align-items: center; }
  .team { flex: 1; min-width: 0; font-weight: 400; font-size: 14px; color: var(--on-surface);
    padding: 0 8px; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
  .team.home { text-align: right; }      /* Team A flanks the score from the left */
  .team:last-child { text-align: left; }  /* Team B flanks the score from the right */
  .sets { font-size: 17px; font-weight: 700; white-space: nowrap; padding: 0 6px;
    color: var(--on-surface); }
  .sets.running { color: var(--team-a); }
  .rowbtns { display: flex; gap: 8px; flex-shrink: 0; }
  .gateinfo p { margin: 0 0 8px; }
  .invite p { margin: 0 0 8px; } .invite p:last-child { margin-bottom: 0; }
  .gatebtns { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
  .jointitle { font-size: 20px; margin: 4px 0 2px; }
  /* retention notice: subtle, but clearly visible (privacy assurance) */
  .retention { color: var(--team-a); font-size: 13px; background: var(--surface);
    border: 1px solid var(--outline); border-radius: 10px; padding: 8px 10px; }
  /* Read-aloud toggle on the live detail — muted when off, green when on (like the app) */
  .readbtn { align-self: center; background: transparent; color: var(--on-surface-variant);
    border: 1px solid var(--outline); border-radius: 999px; padding: 7px 16px; font-size: 14px;
    font-weight: 600; cursor: pointer; }
  .readbtn.on { color: var(--ok); border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .install { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 8px; font-size: 13px; color: var(--on-surface); background: var(--surface);
    border: 1px solid var(--outline); border-radius: 12px; padding: 8px 12px; }
  button.small { padding: 6px 10px; font-size: 13px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }

  /* Bottom navigation (Matches / Training) — Material-3 style like the app */
  .bottomnav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: 100%; max-width: 440px; box-sizing: border-box;
    display: flex; justify-content: space-around; align-items: stretch;
    background: var(--surface); border-top: 1px solid var(--outline); z-index: 50;
    padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); }
  .navitem { flex: 1; background: transparent; border: 0; cursor: pointer; padding: 4px 0;
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    color: var(--on-surface-variant); font: inherit; }
  .naicon { display: flex; align-items: center; justify-content: center;
    width: 56px; height: 30px; border-radius: 16px; transition: background .15s; }
  .naicon svg { width: 24px; height: 24px; display: block; }
  .nalabel { font-size: 12px; font-weight: 600; }
  .navitem.active { color: var(--team-a); }
  .navitem.active .naicon { background: color-mix(in srgb, var(--team-a) 16%, transparent); }

  .filters { display: flex; flex-wrap: wrap; gap: 8px; }
  /* Date / category as Material Assist chips with a picker (like the app). */
  .fchipwrap { position: relative; }
  .fchip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface);
    border: 1px solid var(--outline); border-radius: 8px; padding: 7px 12px; font-size: 14px;
    color: var(--on-surface); cursor: pointer; max-width: 220px; }
  .fci { width: 18px; height: 18px; flex: 0 0 auto; color: var(--on-surface-variant); }
  .fct { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fchip .caret { color: var(--on-surface-variant); }
  .picker { left: 0; right: auto; min-width: 200px; max-height: 60vh; overflow-y: auto; }
  .picker button { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .picker .cnt { color: var(--on-surface-variant); font-size: 13px; }
  .trow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; }
  .trow .meta { margin-left: 8px; }
  .tval { font-weight: 700; white-space: nowrap; }
  .ok { color: var(--ok); } .bad { color: var(--bad); }

  /* clickable list cards — native bg_table_card: 10dp padding */
  .card-btn { width: 100%; text-align: left; color: inherit; font: inherit; font-weight: 400;
    display: block; padding: 10px; }
  .card-btn:active { background: var(--surface-variant); }

  /* live badge — red throbbing dot like LiveDotView, centred on top */
  .live { display: flex; justify-content: center; align-items: center; gap: 6px; color: var(--live);
    font-weight: 700; font-size: 13px; letter-spacing: .12em; margin-bottom: 4px; }
  .live.big { font-size: 14px; margin-bottom: 0; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: var(--live); display: inline-block;
    animation: pulse 1.5s infinite; }
  @keyframes pulse { 0% { transform: scale(1); opacity: 1 } 60% { transform: scale(1.45); opacity: .35 }
    100% { transform: scale(1); opacity: 1 } }

  /* new-match button atop the matches list */
  .newmatch { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 12px 14px; font-size: 15px; font-weight: 800; cursor: pointer; align-self: stretch; }
  /* match detail */
  .dt-right { display: flex; align-items: center; gap: 8px; }
  .detail-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .back { align-self: flex-start; }
  .share-note { margin-top: 6px; font-size: 13px; color: var(--on-surface-variant); text-align: right; }
  .center { text-align: center; }
  .detail { display: flex; flex-direction: column; gap: 12px; }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .hname { font-size: 22px; font-weight: 800; }
  .hname.a { color: var(--team-a); text-align: right; }
  .hname.b { color: var(--team-b); text-align: left; }
  /* Side-swap cross-slide: the new left enters from the left, the new right from
     the right — mirroring swapSides() in the app's edit view. */
  .swap-anim .hname.a { animation: swapInA 300ms ease both; }
  .swap-anim .hname.b { animation: swapInB 300ms ease both; }
  .swap-anim .hsets { animation: swapFade 300ms ease both; }
  @keyframes swapInA { from { transform: translateX(-44px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes swapInB { from { transform: translateX(44px); opacity: 0 } to { transform: none; opacity: 1 } }
  @keyframes swapFade { from { opacity: .2 } to { opacity: 1 } }
  .hsets { font-size: 44px; font-weight: 800; padding: 0 10px; line-height: 1; }
  .setchip { background: var(--surface-variant); color: var(--on-surface-variant);
    border-radius: 8px; padding: 2px 8px; font-size: 12px; font-weight: 500; }
  .setchip.cur { background: transparent; border: 1.5px solid var(--live); color: var(--live);
    font-weight: 700; }
  /* match-tile meta line: kickoff time, then the per-set chips (native order). */
  .metarow { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
  .metarow .meta { flex: 0 0 auto; }
  .chips { flex: 1; display: flex; flex-wrap: wrap; gap: 6px; }
</style>
