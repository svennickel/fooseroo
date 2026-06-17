<script lang="ts">
  // Training capture (web port of the app's Training hub modes):
  //   Zeitmessung (measure) · Zeit & Erfolg (measure_success) · Erfolgsquote (outcome)
  // with a count-up timer + person/category, writing byte-compatible training_entries.
  import { saveMeasure, saveOutcome } from './trainingstore'
  import type { Ctx } from './data'

  let { ctx, nameSuggestions, modeSuggestions, onClose, onSaved }:
    { ctx: Ctx; nameSuggestions: string[]; modeSuggestions: string[]
      onClose: () => void; onSaved: () => void } = $props()

  type Kind = 'measure' | 'measure_success' | 'outcome'
  let kind = $state<Kind>('measure')
  let name = $state('')
  let mode = $state('')
  let limit = $state('')                  // optional time limit in seconds
  let busy = $state(false)
  let err = $state('')
  let note = $state('')                   // brief confirmation (outcome tally etc.)

  // Count-up timer.
  let elapsedMs = $state(0)
  let timerOn = $state(false)
  let startedAt = 0
  let tick: ReturnType<typeof setInterval> | null = null
  function startTimer() { startedAt = Date.now() - elapsedMs; timerOn = true; tick = setInterval(() => { elapsedMs = Date.now() - startedAt }, 50) }
  function stopTimer() { timerOn = false; if (tick) { clearInterval(tick); tick = null } }
  function resetTimer() { stopTimer(); elapsedMs = 0 }
  const elapsedLabel = $derived(`${(elapsedMs / 1000).toFixed(1)}s`)

  async function run(fn: () => Promise<void>, after: () => void) {
    if (busy) return
    busy = true; err = ''
    try { await fn(); onSaved(); after() } catch { err = 'Speichern fehlgeschlagen.' } finally { busy = false }
  }

  function saveTimed(success: boolean | null) {
    stopTimer()
    const lim = Math.max(0, parseInt(limit, 10) || 0)
    run(() => saveMeasure(ctx, { name: name.trim(), mode: mode.trim(), elapsedMs, limit: lim, ts: Date.now(), success }),
      () => onClose())
  }
  function saveOut(success: boolean) {
    run(() => saveOutcome(ctx, { name: name.trim(), mode: mode.trim(), ts: Date.now(), success }),
      () => { note = success ? '✓ Treffer gespeichert' : '✗ Fehler gespeichert'; setTimeout(() => (note = ''), 1500) })
  }
</script>

<div class="overlay" role="presentation">
  <div class="sheet">
    <div class="head"><strong>Neuer Trainingseintrag</strong><button class="ghost small" onclick={() => { resetTimer(); onClose() }}>Schließen</button></div>

    <div class="kinds">
      <button class:on={kind === 'measure'} onclick={() => { kind = 'measure'; resetTimer() }}>Zeitmessung</button>
      <button class:on={kind === 'measure_success'} onclick={() => { kind = 'measure_success'; resetTimer() }}>Zeit &amp; Erfolg</button>
      <button class:on={kind === 'outcome'} onclick={() => { kind = 'outcome' }}>Erfolgsquote</button>
    </div>

    <label class="fld">Name<input bind:value={name} list="tnames" placeholder="Person" /></label>
    <label class="fld">Kategorie<input bind:value={mode} list="tmodes" placeholder="z. B. Bandenpass" /></label>
    <datalist id="tnames">{#each nameSuggestions as n}<option value={n}></option>{/each}</datalist>
    <datalist id="tmodes">{#each modeSuggestions as m}<option value={m}></option>{/each}</datalist>

    {#if kind === 'outcome'}
      <div class="outrow">
        <button class="big ok" onclick={() => saveOut(true)} disabled={busy}>✓ Treffer</button>
        <button class="big bad" onclick={() => saveOut(false)} disabled={busy}>✗ Fehler</button>
      </div>
      {#if note}<p class="note">{note}</p>{/if}
    {:else}
      <div class="timer">{elapsedLabel}</div>
      <div class="trow">
        {#if !timerOn}
          <button class="big" onclick={startTimer}>{elapsedMs > 0 ? 'Weiter' : 'Start'}</button>
        {:else}
          <button class="big" onclick={stopTimer}>Stop</button>
        {/if}
        <button class="ghost small" onclick={resetTimer} disabled={elapsedMs === 0}>Zurücksetzen</button>
      </div>
      <label class="fld">Zeitlimit (Sek., optional)<input inputmode="numeric" bind:value={limit} placeholder="—" /></label>
      {#if kind === 'measure'}
        <button class="primary" onclick={() => saveTimed(null)} disabled={busy || elapsedMs === 0}>Speichern</button>
      {:else}
        <div class="outrow">
          <button class="primary ok" onclick={() => saveTimed(true)} disabled={busy || elapsedMs === 0}>Speichern: ✓ Erfolg</button>
          <button class="primary bad" onclick={() => saveTimed(false)} disabled={busy || elapsedMs === 0}>Speichern: ✗</button>
        </div>
      {/if}
    {/if}
    {#if err}<p class="err">{err}</p>{/if}
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
  /* iOS optic: segmented kind selector as fully-rounded pills */
  :global(html.ios) .kinds button { border-radius: 999px; }
  .kinds button.on { background: color-mix(in srgb, var(--team-a) 16%, transparent);
    border-color: var(--team-a); color: var(--team-a); }
  .fld { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--on-surface-variant); }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 16px; }
  .timer { font-size: 44px; font-weight: 800; text-align: center; line-height: 1; }
  .trow { display: flex; gap: 8px; align-items: center; }
  .outrow { display: flex; gap: 8px; }
  .big { flex: 1; padding: 18px 0; font-size: 18px; font-weight: 800; border: 0; border-radius: 14px;
    background: var(--team-a); color: var(--on-accent); cursor: pointer; }
  .big.ok { background: var(--ok); } .big.bad { background: var(--bad); }
  .primary { flex: 1; background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 13px 14px; font-size: 15px; font-weight: 800; cursor: pointer; }
  .primary.ok { background: var(--ok); } .primary.bad { background: var(--bad); flex: 0 0 auto; padding: 13px 18px; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 9px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .big:disabled, .primary:disabled, .ghost.small:disabled { opacity: .5; cursor: default; }
  .note { color: var(--ok); font-weight: 700; text-align: center; margin: 0; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
