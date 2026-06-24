<script lang="ts">
  // Web port of dialog_category_editor: configure a training category.
  //  Timed kinds (Zeitmessung / Zeit & Erfolg): offered buttons (10s&15s / nur 10s
  //  / nur 15s), hide-the-running-counter, and an optional target time window
  //  (from/to seconds) — the window syncs byte-compatibly (time_measure_windows /
  //  timed_outcome_windows); buttons + hidden counter are device-local like the app.
  //  Erfolgsquote: a target success-percent instead of a window.
  import { saveTrainingWindow, type Ctx } from './data'
  import { rodLimits, buttonModeOf, setButtonMode, counterHiddenOf, setCounterHidden,
    outcomeTargetOf, setOutcomeTarget, type ButtonMode } from './trainingprefs'

  let { ctx, kind, mode, initialWindow, onClose, onSaved }:
    { ctx: Ctx; kind: 'measure' | 'measure_success' | 'outcome'; mode: string
      initialWindow?: { fromSeconds?: number | null; toSeconds?: number | null }
      onClose: () => void; onSaved: () => void } = $props()

  const timed = kind !== 'outcome'
  const { short, long } = rodLimits()

  let buttons = $state<ButtonMode>(buttonModeOf(ctx, kind, mode))
  let hideCounter = $state<boolean>(counterHiddenOf(ctx, kind, mode))
  let from = $state(initialWindow?.fromSeconds != null ? String(initialWindow.fromSeconds) : '')
  let to = $state(initialWindow?.toSeconds != null ? String(initialWindow.toSeconds) : '')
  let target = $state(kind === 'outcome' && outcomeTargetOf(ctx, mode) != null ? String(outcomeTargetOf(ctx, mode)) : '')
  let busy = $state(false)
  let err = $state('')

  const num = (s: string): number | null => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : null }

  async function save() {
    if (busy) return
    busy = true; err = ''
    try {
      if (timed) {
        setButtonMode(ctx, kind, mode, buttons)
        setCounterHidden(ctx, kind, mode, hideCounter)
        await saveTrainingWindow(ctx, kind, mode, { fromSeconds: num(from), toSeconds: num(to) })
      } else {
        const t = num(target)
        setOutcomeTarget(ctx, mode, t == null ? null : Math.max(0, Math.min(100, Math.round(t))))
      }
      onSaved(); onClose()
    } catch { err = 'Speichern fehlgeschlagen.' } finally { busy = false }
  }
</script>

<div class="overlay" onclick={(e) => { if (e.target === e.currentTarget) onClose() }} role="presentation">
  <div class="sheet">
    <div class="head"><strong>Kategorie „{mode || 'Standard'}“</strong>
      <button class="ghost" onclick={onClose}>Schließen</button></div>

    {#if timed}
      <div class="grp"><span class="lbl">Angebotene Knöpfe</span>
        <div class="seg">
          <button class:on={buttons === 'BOTH'} onclick={() => (buttons = 'BOTH')}>{short}s &amp; {long}s</button>
          <button class:on={buttons === 'SHORT'} onclick={() => (buttons = 'SHORT')}>nur {short}s</button>
          <button class:on={buttons === 'LONG'} onclick={() => (buttons = 'LONG')}>nur {long}s</button>
        </div>
      </div>

      <label class="row"><span>Zähler beim Laufen verbergen</span>
        <input type="checkbox" bind:checked={hideCounter} /></label>

      <div class="grp"><span class="lbl">Zeitfenster (optional, Sek.)</span>
        <div class="winrow">
          <label class="fld">Von<input inputmode="decimal" bind:value={from} placeholder="—" /></label>
          <label class="fld">Bis<input inputmode="decimal" bind:value={to} placeholder="—" /></label>
        </div>
        <p class="hint">Innerhalb des Fensters grün, davor/danach orange, über dem Limit rot.</p>
      </div>
    {:else}
      <div class="grp"><span class="lbl">Ziel-Erfolgsquote (optional, %)</span>
        <label class="fld"><input inputmode="numeric" bind:value={target} placeholder="—" /></label>
        <p class="hint">Erreicht die Quote das Ziel, wird sie grün angezeigt, sonst orange.</p>
      </div>
    {/if}

    {#if err}<p class="err">{err}</p>{/if}
    <button class="primary" onclick={save} disabled={busy}>Speichern</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 970; background: rgba(0,0,0,.5);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 14px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 16px; }
  .grp { display: flex; flex-direction: column; gap: 6px; }
  .lbl { font-size: 13px; color: var(--on-surface-variant); font-weight: 600; }
  .seg { display: flex; gap: 6px; }
  .seg button { flex: 1; background: var(--surface); border: 1px solid var(--outline); border-radius: 10px;
    padding: 10px 6px; font-size: 13px; font-weight: 600; color: var(--on-surface); cursor: pointer; }
  .seg button.on { background: color-mix(in srgb, var(--team-a) 16%, transparent);
    border-color: var(--team-a); color: var(--team-a); }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; }
  .row input { width: 22px; height: 22px; }
  .winrow { display: flex; gap: 10px; }
  .fld { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--on-surface-variant); }
  .fld input { padding: 11px 13px; border-radius: 10px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 16px; }
  .hint { font-size: 12px; color: var(--on-surface-variant); margin: 2px 0 0; }
  .ghost { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 14px; font-size: 15px; font-weight: 800; cursor: pointer; }
  .primary:disabled { opacity: .5; cursor: default; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
