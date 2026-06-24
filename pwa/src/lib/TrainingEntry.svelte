<script lang="ts">
  // Training capture — web port of the app's recording screens (TimeMeasure /
  // TimeSuccess / Outcome). A COUNT-DOWN measurement from the rod limit (10s/15s,
  // ITSF; Saarland 20/20) with the app's colour gradient (neutral→green→amber→red)
  // and a 10s overtime buffer; for "Zeit & Erfolg" the running buttons become ✓/✗.
  // Per category: offered buttons, hidden running counter and a target time window.
  // Writes byte-compatible training_entries (saveMeasure/saveOutcome).
  import { saveMeasure, saveOutcome } from './trainingstore'
  import { loadTrainingModes, saveTrainingModes, loadTrainingWindows, addPlayersToPool,
    dayKey, type Ctx, type TrainingItem, type TimeWindow } from './data'
  import { signedElapsed, countdownColor, timeBoundLabel, OVERTIME_MS } from './trainingmath'
  import { rodLimits, buttonModeOf, counterHiddenOf, countdownDescending } from './trainingprefs'
  import ChoicePicker from './ChoicePicker.svelte'
  import TrainingCategoryEditor from './TrainingCategoryEditor.svelte'

  let { ctx, pool, peerTraining, onClose, onSaved }:
    { ctx: Ctx; pool: string[]; peerTraining: TrainingItem[]
      onClose: () => void; onSaved: () => void } = $props()

  type Kind = 'measure' | 'measure_success' | 'outcome'
  let kind = $state<Kind>('measure')
  let name = $state('')
  let mode = $state('')
  let poolState = $state<string[]>([...pool])
  let modes = $state<string[]>([])
  let windows = $state<Record<string, TimeWindow>>({})
  let picking = $state<'name' | 'mode' | null>(null)
  let editing = $state<string | null>(null)   // category being edited

  // Reload the per-kind mode list + windows when the kind changes.
  $effect(() => {
    const k = kind
    loadTrainingModes(ctx, k).then((m) => { if (k === kind) modes = m }).catch(() => {})
    loadTrainingWindows(ctx, k).then((w) => { if (k === kind) windows = w }).catch(() => {})
  })

  const today = dayKey(Date.now())
  const nameCounts = $derived.by(() => { const m: Record<string, number> = {}; for (const t of peerTraining) if (t.kind === kind && dayKey(t.at) === today && t.name) m[t.name] = (m[t.name] ?? 0) + 1; return m })
  const modeCounts = $derived.by(() => { const m: Record<string, number> = {}; for (const t of peerTraining) if (t.kind === kind && dayKey(t.at) === today && t.mode) m[t.mode] = (m[t.mode] ?? 0) + 1; return m })
  const modeSuffixes = $derived.by(() => { const m: Record<string, string> = {}; for (const k of modes) { const s = timeBoundLabel(windows[k]?.fromSeconds, windows[k]?.toSeconds); if (s) m[k] = s.replace(/^ – /, '') } return m })

  async function addName(n: string) {
    if (!poolState.includes(n)) poolState = [...poolState, n]
    try { poolState = await addPlayersToPool(ctx, [n]) } catch { /* keep local */ }
  }
  async function addMode(m: string) {
    if (!modes.includes(m)) { modes = [...modes, m]; try { await saveTrainingModes(ctx, kind, modes) } catch { /* keep local */ } }
  }

  // ---- Countdown engine (mirrors TimeMeasureFragment) -------------------------
  const { short, long } = rodLimits()
  const btnMode = $derived(buttonModeOf(ctx, kind, mode))
  const hidden = $derived(counterHiddenOf(ctx, kind, mode))
  const win = $derived<TimeWindow | undefined>(windows[mode])

  let running = $state(false)
  let rod = $state(0)              // seconds of the active rod
  let elapsedMs = $state(0)
  let lastFoul = $state(false)
  let hasResult = $state(false)    // a completed measurement is shown
  let gaveUp = $state(false)       // overtime expired without a stop
  let note = $state('')
  let busy = $state(false)
  let err = $state('')
  let startedAt = 0
  let tick: ReturnType<typeof setInterval> | null = null

  const limitMs = $derived(rod * 1000)
  const remainingMs = $derived(limitMs - elapsedMs)

  function clearTick() { if (tick) { clearInterval(tick); tick = null } }
  function reset() { clearTick(); running = false; elapsedMs = 0; hasResult = false; gaveUp = false; note = '' }

  function start(rodSeconds: number) {
    clearTick()
    rod = rodSeconds
    elapsedMs = 0; hasResult = false; gaveUp = false; note = ''
    startedAt = Date.now()
    running = true
    tick = setInterval(() => {
      elapsedMs = Date.now() - startedAt
      if (elapsedMs >= rodSeconds * 1000 + OVERTIME_MS) { giveUp() }
    }, 30)
  }
  function giveUp() { clearTick(); running = false; gaveUp = true; hasResult = false }

  function stop(success: boolean | null) {
    if (!running) return
    clearTick()
    running = false
    const ms = Date.now() - startedAt
    elapsedMs = ms
    lastFoul = ms > rod * 1000
    hasResult = true
    persist(ms, rod, success)
  }

  async function persist(ms: number, rodSeconds: number, success: boolean | null) {
    if (busy) return
    busy = true; err = ''
    try {
      await saveMeasure(ctx, { name: name.trim(), mode: mode.trim(), elapsedMs: ms, limit: rodSeconds, ts: Date.now(), success })
      note = success === null ? '✓ gespeichert' : success ? '✓ Erfolg gespeichert' : '✗ Fehler gespeichert'
      setTimeout(() => (note = ''), 1600)
      onSaved()
    } catch { err = 'Speichern fehlgeschlagen.' } finally { busy = false }
  }

  function saveOut(success: boolean) {
    if (busy) return
    busy = true; err = ''
    saveOutcome(ctx, { name: name.trim(), mode: mode.trim(), ts: Date.now(), success })
      .then(() => { note = success ? '✓ Treffer gespeichert' : '✗ Fehler gespeichert'; setTimeout(() => (note = ''), 1600); onSaved() })
      .catch(() => { err = 'Speichern fehlgeschlagen.' })
      .finally(() => { busy = false })
  }

  // The big display: text + signal colour, mirroring timerView*.
  const display = $derived.by(() => {
    if (running) {
      if (hidden) return { text: 'läuft …', color: '#43A047' }
      const shown = countdownDescending() ? remainingMs : elapsedMs
      return { text: signedElapsed(shown), color: countdownColor(remainingMs, limitMs) }
    }
    if (gaveUp) return { text: 'Zeit!', color: '#E53935' }
    if (hasResult) return { text: signedElapsed(elapsedMs), color: lastFoul ? '#E53935' : '#43A047' }
    return { text: 'Start', color: '#43A047' }
  })

  const showShort = $derived(btnMode !== 'LONG')
  const showLong = $derived(btnMode !== 'SHORT')

  function reloadCat() { loadTrainingWindows(ctx, kind).then((w) => { windows = w }).catch(() => {}) }
</script>

<div class="overlay" role="presentation">
  <div class="sheet">
    <div class="head"><strong>Neuer Trainingseintrag</strong>
      <button class="ghost small" onclick={() => { reset(); onClose() }}>Schließen</button></div>

    <div class="kinds">
      <button class:on={kind === 'measure'} onclick={() => { kind = 'measure'; reset() }}>Zeitmessung</button>
      <button class:on={kind === 'measure_success'} onclick={() => { kind = 'measure_success'; reset() }}>Zeit &amp; Erfolg</button>
      <button class:on={kind === 'outcome'} onclick={() => { kind = 'outcome'; reset() }}>Erfolgsquote</button>
    </div>

    <div class="pick"><span class="plabel">Name</span>
      <button class="pchip" class:set={!!name} onclick={() => (picking = 'name')}>{name || 'Person wählen'}</button></div>
    <div class="pick"><span class="plabel">Kategorie</span>
      <div class="catrow">
        <button class="pchip" class:set={!!mode} onclick={() => (picking = 'mode')}>{mode || 'Kategorie wählen'}</button>
        {#if mode}<button class="edit" aria-label="Kategorie bearbeiten" onclick={() => (editing = mode)}>✎</button>{/if}
      </div>
    </div>
    {#if mode && timeBoundLabel(win?.fromSeconds, win?.toSeconds)}
      <p class="winlbl">Zeitfenster{timeBoundLabel(win?.fromSeconds, win?.toSeconds)}</p>
    {/if}

    {#if kind === 'outcome'}
      <div class="outrow">
        <button class="big ok" onclick={() => saveOut(true)} disabled={busy}>✓ Treffer</button>
        <button class="big bad" onclick={() => saveOut(false)} disabled={busy}>✗ Fehler</button>
      </div>
      {#if note}<p class="note">{note}</p>{/if}
    {:else}
      <!-- Big countdown display (tap to stop a running measurement). -->
      <button class="countdown" style="background:{display.color}"
              onclick={() => { if (running && kind === 'measure') stop(null) }}>{display.text}</button>

      {#if running}
        {#if kind === 'measure_success'}
          <div class="outrow">
            <button class="big ok" onclick={() => stop(true)}>✓</button>
            <button class="big bad" onclick={() => stop(false)}>✗</button>
          </div>
        {:else}
          <button class="big stop" onclick={() => stop(null)}>Stopp</button>
        {/if}
      {:else}
        <div class="rods">
          {#if showShort}<button class="big" onclick={() => start(short)}>{short}s</button>{/if}
          {#if showLong}<button class="big" onclick={() => start(long)}>{long}s</button>{/if}
        </div>
        <p class="hint">Knopf startet die {kind === 'measure_success' ? 'Messung – dann ✓/✗ zum Stoppen' : 'Messung – Anzeige oder „Stopp“ beendet sie'}.</p>
      {/if}
      {#if note}<p class="note">{note}</p>{/if}
    {/if}
    {#if err}<p class="err">{err}</p>{/if}

    {#if picking === 'name'}
      <ChoicePicker title="Person" items={poolState} selected={name ? [name] : []} maxSelection={1}
        counts={nameCounts} onAdd={(n) => addName(n)}
        onPicked={(names) => { name = names[0] ?? name }} onClose={() => (picking = null)} />
    {:else if picking === 'mode'}
      <ChoicePicker title="Kategorie" items={modes} selected={mode ? [mode] : []} maxSelection={1}
        counts={modeCounts} suffixes={modeSuffixes} onAdd={(m) => addMode(m)}
        onEdit={(m) => { picking = null; editing = m }}
        onPicked={(names) => { mode = names[0] ?? mode }} onClose={() => (picking = null)} />
    {/if}

    {#if editing}
      <TrainingCategoryEditor {ctx} {kind} mode={editing} initialWindow={windows[editing]}
        onSaved={reloadCat} onClose={() => (editing = null)} />
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 940; background: rgba(0,0,0,.5);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 94vh; overflow-y: auto; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 12px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head strong { font-size: 17px; }
  .kinds { display: flex; gap: 6px; }
  .kinds button { flex: 1; background: var(--surface); border: 1px solid var(--outline); border-radius: 10px;
    padding: 9px 6px; font-size: 13px; font-weight: 600; color: var(--on-surface); cursor: pointer; }
  :global(html.ios) .kinds button { border-radius: 999px; }
  .kinds button.on { background: color-mix(in srgb, var(--team-a) 16%, transparent);
    border-color: var(--team-a); color: var(--team-a); }
  .pick { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .plabel { font-size: 13px; color: var(--on-surface-variant); }
  .catrow { display: flex; align-items: center; gap: 6px; max-width: 74%; }
  .pchip { background: var(--surface); border: 1px solid var(--outline); border-radius: 999px;
    padding: 9px 16px; font-size: 14px; color: var(--on-surface-variant); cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick > .pchip { max-width: 70%; }
  .pchip.set { color: var(--on-surface); font-weight: 700; border-color: var(--team-a); }
  .edit { background: transparent; border: 1px solid var(--outline); border-radius: 999px;
    width: 36px; height: 36px; font-size: 14px; color: var(--on-surface-variant); cursor: pointer; flex: 0 0 auto; }
  .winlbl { margin: -4px 0 0; font-size: 12px; color: var(--on-surface-variant); }
  /* The big signal display: white text on the live colour, like the app's box. */
  .countdown { border: 0; border-radius: 16px; padding: 22px 0; font-size: 52px; font-weight: 800;
    line-height: 1; color: #fff; text-align: center; cursor: pointer; letter-spacing: .5px;
    text-shadow: 0 1px 2px rgba(0,0,0,.25); transition: background .12s linear; }
  .rods { display: flex; gap: 8px; }
  .outrow { display: flex; gap: 8px; }
  .big { flex: 1; padding: 18px 0; font-size: 22px; font-weight: 800; border: 0; border-radius: 14px;
    background: var(--team-a); color: var(--on-accent); cursor: pointer; }
  .big.ok { background: var(--ok); } .big.bad { background: var(--bad); }
  .big.stop { background: var(--on-surface-variant); }
  .hint { font-size: 12px; color: var(--on-surface-variant); margin: 0; text-align: center; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 9px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .big:disabled { opacity: .5; cursor: default; }
  .note { color: var(--ok); font-weight: 700; text-align: center; margin: 0; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
