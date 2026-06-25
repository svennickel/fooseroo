<script lang="ts">
  // Training capture — web port of the app's recording screens (TimeMeasure /
  // TimeSuccess / Outcome). A COUNT-DOWN measurement from the rod limit (10s/15s,
  // ITSF; Saarland 20/20) with the app's colour gradient (neutral→green→amber→red)
  // and a 10s overtime buffer; for "Zeit & Erfolg" the running buttons become ✓/✗.
  // Per category: offered buttons, hidden running counter and a target time window.
  // Writes byte-compatible training_entries (saveMeasure/saveOutcome).
  import { saveMeasure, saveOutcome, deleteTraining } from './trainingstore'
  import { loadTrainingModes, saveTrainingModes, loadTrainingWindows, addPlayersToPool,
    dayKey, type Ctx, type TrainingItem, type TimeWindow } from './data'
  import { signedElapsed, countdownColor, timeBoundLabel, OVERTIME_MS } from './trainingmath'
  import { rodLimits, buttonModeOf, counterHiddenOf, countdownDescending } from './trainingprefs'
  import { t, getLang } from './i18n.svelte'
  import ChoicePicker from './ChoicePicker.svelte'
  import TrainingCategoryEditor from './TrainingCategoryEditor.svelte'
  import TrainingChart from './TrainingChart.svelte'
  import TrainingRowMenu from './TrainingRowMenu.svelte'

  type Kind = 'measure' | 'measure_success' | 'outcome'
  let { ctx, pool, peerTraining, initialKind = 'measure', onClose, onSaved }:
    { ctx: Ctx; pool: string[]; peerTraining: TrainingItem[]; initialKind?: Kind
      onClose: () => void; onSaved: () => void } = $props()

  let kind = $state<Kind>(initialKind)
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
  const modeSuffixes = $derived.by(() => { const m: Record<string, string> = {}; for (const k of modes) { const s = timeBoundLabel(windows[k]?.fromSeconds, windows[k]?.toSeconds, getLang()); if (s) m[k] = s.replace(/^ – /, '') } return m })

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
      note = success === null ? t('training.saved') : success ? t('training.saved_ok') : t('training.saved_fail')
      setTimeout(() => (note = ''), 1600)
      viewDay = dayKey(Date.now())
      onSaved()
    } catch { err = t('training.save_failed') } finally { busy = false }
  }

  function saveOut(success: boolean) {
    if (busy) return
    busy = true; err = ''
    saveOutcome(ctx, { name: name.trim(), mode: mode.trim(), ts: Date.now(), success })
      .then(() => { note = success ? t('training.saved_hit') : t('training.saved_miss'); setTimeout(() => (note = ''), 1600); viewDay = dayKey(Date.now()); onSaved() })
      .catch(() => { err = t('training.save_failed') })
      .finally(() => { busy = false })
  }

  // The big display: text + signal colour, mirroring timerView*.
  const display = $derived.by(() => {
    if (running) {
      if (hidden) return { text: t('training.running'), color: '#43A047' }
      const shown = countdownDescending() ? remainingMs : elapsedMs
      return { text: signedElapsed(shown), color: countdownColor(remainingMs, limitMs) }
    }
    if (gaveUp) return { text: t('training.time_over'), color: '#E53935' }
    if (hasResult) return { text: signedElapsed(elapsedMs), color: lastFoul ? '#E53935' : '#43A047' }
    return { text: t('training.start'), color: '#43A047' }
  })

  const showShort = $derived(btnMode !== 'LONG')
  const showLong = $derived(btnMode !== 'SHORT')

  function reloadCat() { loadTrainingWindows(ctx, kind).then((w) => { windows = w }).catch(() => {}) }

  // ---- Day view + entries list + row menu (the full-screen app recording view) --
  const kindLabel = (k: string) => k === 'measure' ? t('training.kind_measure') : k === 'measure_success' ? t('training.kind_success') : t('training.kind_outcome')
  let viewDay = $state(dayKey(Date.now()))
  let pickingDay = $state(false)
  let editingEntry = $state<TrainingItem | null>(null)

  // Entries of THIS kind on the viewed day (and the selected category, if one is
  // chosen) — the chart groups by category, the list shows them newest-first.
  const dayItems = $derived(peerTraining.filter((e) => e.kind === kind && dayKey(e.at) === viewDay && (!mode || (e.mode || '') === mode)))
  const days = $derived.by(() => {
    const set = new Set<string>([dayKey(Date.now())])
    for (const e of peerTraining) if (e.kind === kind) set.add(dayKey(e.at))
    return [...set].sort((a, b) => b.localeCompare(a))
  })
  function dayLabel(key: string): string {
    if (key === dayKey(Date.now())) return t('eval.today')
    if (key === dayKey(Date.now() - 86400000)) return t('eval.yesterday')
    const y = +key.slice(0, 4), mo = +key.slice(4, 6) - 1, d = +key.slice(6, 8)
    return new Date(y, mo, d).toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })
  }

  // Undo the most recent outcome of this person+category today (app's "Undo last").
  async function undoLast() {
    if (busy) return
    const newest = peerTraining.find((e) => e.kind === 'outcome' && dayKey(e.at) === dayKey(Date.now())
      && e.name === name.trim() && (e.mode || '') === mode.trim())
    if (!newest) return
    busy = true
    try { await deleteTraining(ctx, newest); onSaved() } catch { /* ignore */ } finally { busy = false }
  }
</script>

<div class="overlay" role="presentation">
  <div class="sheet">
    <div class="head">
      <button class="back" onclick={() => { reset(); onClose() }}>{'‹'} {t('common.back_word')}</button>
      <strong>{kindLabel(kind)}</strong>
      <span class="hsp"></span>
    </div>

    <!-- Chips like the app: date · category(+edit) · person -->
    <div class="chips">
      <button class="chip" onclick={() => (pickingDay = true)}>📅 {dayLabel(viewDay)} ▾</button>
      <span class="catwrap">
        <button class="chip" class:set={!!mode} onclick={() => (picking = 'mode')}>{mode || t('training.pick_category')}{#if mode && timeBoundLabel(win?.fromSeconds, win?.toSeconds, getLang())}<span class="sfx">{timeBoundLabel(win?.fromSeconds, win?.toSeconds, getLang()).replace(/^ – /, ' ')}</span>{/if}</button>
        {#if mode}<button class="catedit" aria-label={t('training.category')} onclick={() => (editing = mode)}>✎</button>{/if}
      </span>
      <button class="chip" class:set={!!name} onclick={() => (picking = 'name')}>👤 {name || t('training.pick_person')}</button>
    </div>

    <!-- Scrollable middle: chart + entries of the viewed day (tap a row to edit). -->
    <div class="mid">
      {#if dayItems.length}
        <TrainingChart items={dayItems} {ctx} />
        <ul class="elist">
          {#each dayItems.slice(0, 60) as e}
            <li><button class="erow" onclick={() => (editingEntry = e)}>
              <span class="ename"><strong>{e.name || '—'}</strong>{#if e.mode} · {e.mode}{/if}</span>
              <span class="eval">
                {#if e.kind === 'outcome'}<span class={e.success ? 'ok' : 'bad'}>{e.success ? '✓' : '✗'}</span>
                {:else}{signedElapsed(e.elapsedMs ?? 0)}{#if e.kind === 'measure_success'}<span class={e.success ? 'ok' : 'bad'}>{e.success ? ' ✓' : ' ✗'}</span>{/if}{/if}
              </span>
              <span class="echev">›</span>
            </button></li>
          {/each}
        </ul>
      {:else}
        <p class="hint empty">{t('training.no_entries')}</p>
      {/if}
    </div>

    <!-- Bottom action area (countdown + rod buttons / hit-miss + undo), like the app. -->
    <div class="footer">
      {#if kind === 'outcome'}
        <div class="outrow">
          <button class="big ok" onclick={() => saveOut(true)} disabled={busy}>{t('training.hit')}</button>
          <button class="big bad" onclick={() => saveOut(false)} disabled={busy}>{t('training.miss')}</button>
        </div>
        <button class="undo" onclick={undoLast} disabled={busy}>{t('training.undo_last')}</button>
      {:else}
        <button class="countdown" style="background:{display.color}"
                onclick={() => { if (running && kind === 'measure') stop(null) }}>{display.text}</button>
        {#if running}
          {#if kind === 'measure_success'}
            <div class="outrow">
              <button class="big ok" onclick={() => stop(true)}>✓</button>
              <button class="big bad" onclick={() => stop(false)}>✗</button>
            </div>
          {:else}
            <button class="big stop" onclick={() => stop(null)}>{t('training.stop')}</button>
          {/if}
        {:else}
          <div class="rods">
            {#if showShort}<button class="big" onclick={() => start(short)}>{short}s</button>{/if}
            {#if showLong}<button class="big" onclick={() => start(long)}>{long}s</button>{/if}
          </div>
        {/if}
      {/if}
      {#if note}<p class="note">{note}</p>{/if}
      {#if err}<p class="err">{err}</p>{/if}
    </div>

    {#if pickingDay}
      <div class="daypick" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) pickingDay = false }}>
        <div class="dsheet"><strong>{t('eval.pick_day')}</strong>
          {#each days as d}
            <button class="drow" class:on={d === viewDay} onclick={() => { viewDay = d; pickingDay = false }}>{d === viewDay ? '✓ ' : ''}{dayLabel(d)}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if editingEntry}
      <TrainingRowMenu {ctx} entry={editingEntry} {kindLabel}
        pool={poolState} onClose={() => (editingEntry = null)} onChanged={() => { onSaved() }} />
    {/if}

    {#if picking === 'name'}
      <ChoicePicker title={t('training.person')} items={poolState} selected={name ? [name] : []} maxSelection={1}
        counts={nameCounts} onAdd={(n) => addName(n)}
        onPicked={(names) => { name = names[0] ?? name }} onClose={() => (picking = null)} />
    {:else if picking === 'mode'}
      <ChoicePicker title={t('training.category')} items={modes} selected={mode ? [mode] : []} maxSelection={1}
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
  /* Full-screen like the app's recording screen (not a bottom sheet): chips on top,
     chart + list scroll in the middle, the countdown/buttons sit at the bottom. */
  .overlay { position: fixed; inset: 0 0 var(--navh, 56px) 0; z-index: 940; background: var(--bg);
    display: flex; align-items: stretch; justify-content: center; }
  .sheet { width: 100%; max-width: 480px; height: 100%; overflow: hidden; background: var(--bg);
    display: flex; flex-direction: column; gap: 10px;
    padding: calc(12px + env(safe-area-inset-top, 0px)) 16px calc(12px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: center; gap: 8px; }
  .head strong { font-size: 17px; flex: 1; text-align: center; }
  .back { background: transparent; border: 0; color: var(--team-a); font-size: 15px; font-weight: 700;
    cursor: pointer; padding: 4px 6px; }
  .hsp { width: 60px; flex: 0 0 auto; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip { background: var(--surface); border: 1px solid var(--outline); border-radius: 999px;
    padding: 8px 14px; font-size: 14px; color: var(--on-surface-variant); cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
  .chip.set { color: var(--on-surface); font-weight: 700; border-color: var(--team-a); }
  .catwrap { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
  .sfx { color: var(--on-surface-variant); font-weight: 400; font-size: 12px; }
  .catedit { background: transparent; border: 1px solid var(--outline); border-radius: 999px;
    width: 32px; height: 32px; font-size: 13px; color: var(--on-surface-variant); cursor: pointer; flex: 0 0 auto; }
  .mid { flex: 1; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
    display: flex; flex-direction: column; gap: 8px; }
  .empty { padding-top: 24px; }
  .elist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .erow { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer;
    background: var(--surface); border: 1px solid var(--outline); border-radius: 10px; padding: 10px 12px;
    color: inherit; font: inherit; }
  .ename { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eval { margin-left: auto; font-weight: 700; white-space: nowrap; }
  .echev { color: var(--on-surface-variant); font-size: 18px; flex: 0 0 auto; }
  .footer { display: flex; flex-direction: column; gap: 8px; flex: 0 0 auto; }
  /* The big signal display: white text on the live colour, like the app's box. */
  .countdown { border: 0; border-radius: 16px; padding: 20px 0; font-size: 48px; font-weight: 800;
    line-height: 1; color: #fff; text-align: center; cursor: pointer; letter-spacing: .5px;
    text-shadow: 0 1px 2px rgba(0,0,0,.25); transition: background .12s linear; }
  .rods { display: flex; gap: 8px; }
  .outrow { display: flex; gap: 8px; }
  .big { flex: 1; padding: 18px 0; font-size: 22px; font-weight: 800; border: 0; border-radius: 14px;
    background: var(--team-a); color: var(--on-accent); cursor: pointer; }
  .big.ok { background: var(--ok); } .big.bad { background: var(--bad); }
  .big.stop { background: var(--on-surface-variant); }
  .undo { background: transparent; border: 1px solid var(--outline); border-radius: 12px; padding: 11px;
    font-size: 14px; font-weight: 700; color: var(--on-surface-variant); cursor: pointer; }
  .undo:disabled { opacity: .5; cursor: default; }
  .hint { font-size: 13px; color: var(--on-surface-variant); margin: 0; text-align: center; }
  .big:disabled { opacity: .5; cursor: default; }
  .note { color: var(--ok); font-weight: 700; text-align: center; margin: 0; }
  .err { color: var(--bad); font-size: 13px; margin: 0; text-align: center; }
  /* day picker (bottom sheet — small, like the app's date picker) */
  .daypick { position: fixed; inset: 0 0 var(--navh, 56px) 0; z-index: 980; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .dsheet { width: 100%; max-width: 440px; max-height: 70vh; overflow-y: auto; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 4px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .dsheet strong { font-size: 16px; margin-bottom: 6px; }
  .drow { text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--outline);
    padding: 12px 4px; font-size: 15px; color: var(--on-surface); cursor: pointer; }
  .drow.on { color: var(--team-a); font-weight: 700; }
</style>
