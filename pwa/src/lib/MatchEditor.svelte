<script lang="ts">
  // Full match scoring editor — the web port of the app's match counter. Creates a
  // NEW match (team/category setup → live scoring) or edits an existing one, with
  // every action: Tor, Aufschlag, Auszeit, Reset, Rückgängig, Satz beenden,
  // Seitentausch. While live it is the editor on the broadcast channel (pushes each
  // change; a newer claim takes over from the app) and writes the byte-identical
  // matches row. Park / Beenden / Verwerfen mirror the app.
  import { applyAction, undo, swapSides, replaceActions, emptyScore, setsWonFromGames,
    type ScoreState, type Team } from './scoring'
  import { saveMatchRow, discardMatchRow } from './matchstore'
  import { createLiveEditor, liveChannelId, type LiveEditor } from './livematch'
  import { parseMatchState, progressRows } from './match'
  import type { MatchItem } from './data'
  import MatchProgress from './MatchProgress.svelte'

  let { mode, ctx, myUserId, initial, nameSuggestions, categorySuggestions, defaultCategory, onClose, onSaved }:
    { mode: 'new' | 'edit'; ctx: string | null; myUserId: string | null; initial?: MatchItem | null
      nameSuggestions: string[]; categorySuggestions: string[]; defaultCategory: string
      onClose: () => void; onSaved: () => void } = $props()

  let phase = $state<'setup' | 'scoring'>(mode === 'new' ? 'setup' : 'scoring')
  let teamA = $state(initial?.homeName && initial.homeName !== '–' ? initial.homeName : '')
  let teamB = $state(initial?.awayName && initial.awayName !== '–' ? initial.awayName : '')
  let category = $state(initial?.category ?? defaultCategory)
  let editName = $state<'a' | 'b' | null>(null)
  let score = $state<ScoreState>(
    mode === 'edit' ? replaceActions(((initial?.state as { matchActions?: unknown[] } | null)?.matchActions as never) ?? []) : emptyScore())
  let running = $state(mode === 'new' ? true : !!initial?.running)
  let ts = $state(initial?.at ?? 0)
  let err = $state('')
  let editor: LiveEditor | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const labelA = $derived(teamA.trim() || '–')
  const labelB = $derived(teamB.trim() || '–')
  const view = $derived(parseMatchState(JSON.parse(JSON.stringify(score)), running))
  const progress = $derived(progressRows(view, running))
  const sets = $derived(setsWonFromGames(score.games))
  const canFinishSet = $derived(score.goalsA > 0 || score.goalsB > 0)

  function startLiveEditor() {
    const scope = ctx ?? myUserId
    if (!scope) return
    editor = createLiveEditor(liveChannelId(scope, ts),
      () => ({ json: JSON.stringify(score), teamA: labelA, teamB: labelB }))
  }
  function pushLive() { if (running && editor) editor.push(JSON.stringify(score), labelA, labelB) }
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { saveRow(running).catch(() => {}) }, 1200)
  }
  async function saveRow(run: boolean) {
    await saveMatchRow({ groupId: ctx, ts, teamA: labelA, teamB: labelB,
      category: category.trim() || null, state: score, running: run })
  }
  // Apply a change. While live (new / running): broadcast + debounce-persist. While
  // editing a FINISHED match: change locally only — persist on explicit "Speichern"
  // so "Abbrechen" truly reverts (and never deletes the match).
  function change(next: ScoreState | null) { if (!next) return; score = next; if (running) { pushLive(); scheduleSave() } }
  const goal = (t: Team) => change(applyAction(score, t, 'GOAL'))
  const serve = (t: Team) => change(applyAction(score, t, 'SERVE'))
  const timeout = (t: Team) => change(applyAction(score, t, 'TIMEOUT'))
  const reset = (t: Team) => change(applyAction(score, t, 'RESET'))
  const finishSet = () => change(applyAction(score, 'NONE', 'GAME_FINISHED'))
  const doUndo = () => { score = undo(score); if (running) { pushLive(); scheduleSave() } }
  const doSwap = () => { score = swapSides(score); if (running) { pushLive(); scheduleSave() } }
  function onName() { if (running) pushLive(); scheduleSave() }

  async function start() {
    if (mode !== 'new') return
    ts = Date.now(); running = true; phase = 'scoring'
    startLiveEditor()
    try { await saveRow(true) } catch { /* persisted on next change */ }
    pushLive()
  }
  // For editing an already-running match, take over as the live editor.
  $effect(() => { if (phase === 'scoring' && running && !editor && mode === 'edit') startLiveEditor() })

  function cleanup() { if (saveTimer) clearTimeout(saveTimer); editor?.leave(); editor = null }
  async function finish() {
    if (saveTimer) clearTimeout(saveTimer)
    try { running = false; await saveRow(false) } catch { err = 'Speichern fehlgeschlagen.'; return }
    editor?.end(JSON.stringify(score), false); cleanup(); onSaved(); onClose()
  }
  async function park() {
    if (saveTimer) clearTimeout(saveTimer)
    try { await saveRow(true) } catch { err = 'Speichern fehlgeschlagen.'; return }
    cleanup(); onSaved(); onClose()   // row stays running; editor stops broadcasting
  }
  async function saveEdited() {
    if (saveTimer) clearTimeout(saveTimer)
    try { await saveRow(running) } catch { err = 'Speichern fehlgeschlagen.'; return }
    if (running) editor?.push(JSON.stringify(score), labelA, labelB)
    cleanup(); onSaved(); onClose()
  }
  async function discard() {
    if (saveTimer) clearTimeout(saveTimer)
    try { await discardMatchRow(ctx, ts) } catch { err = 'Verwerfen fehlgeschlagen.'; return }
    editor?.end(null, true); cleanup(); onSaved(); onClose()
  }
  function cancel() { cleanup(); onClose() }
</script>

<div class="overlay" role="presentation">
  <div class="sheet">
    {#if phase === 'setup'}
      <div class="head"><strong>Neues Match</strong><button class="ghost small" onclick={cancel}>Abbrechen</button></div>
      <label class="fld">Team links<input bind:value={teamA} list="names" placeholder="Name (z. B. Paul & Anna)" /></label>
      <label class="fld">Team rechts<input bind:value={teamB} list="names" placeholder="Name" /></label>
      <label class="fld">Kategorie<input bind:value={category} list="cats" placeholder="Freies Spiel" /></label>
      <datalist id="names">{#each nameSuggestions as n}<option value={n}></option>{/each}</datalist>
      <datalist id="cats">{#each categorySuggestions as c}<option value={c}></option>{/each}</datalist>
      <button class="primary" onclick={start}>Spiel starten</button>
      {#if err}<p class="err">{err}</p>{/if}
    {:else}
      <div class="head">
        <strong>{running ? 'Live erfassen' : 'Bearbeiten'}</strong>
        <button class="ghost small" onclick={cancel}>Schließen</button>
      </div>

      <!-- Hero: names + the SET score (like the app); current-set goals live only in
           the Verlauf LIVE row below — no separate goal counter. -->
      <div class="hero">
        <div class="side a">
          {#if editName === 'a'}
            <input class="nin" bind:value={teamA} onblur={() => { editName = null; onName() }}
                   onkeydown={(e) => { if (e.key === 'Enter') { editName = null; onName() } }} />
          {:else}
            <button class="nm a" onclick={() => (editName = 'a')}>{labelA} ✎</button>
          {/if}
        </div>
        <div class="cur">{sets.a} : {sets.b}</div>
        <div class="side b">
          {#if editName === 'b'}
            <input class="nin" bind:value={teamB} onblur={() => { editName = null; onName() }}
                   onkeydown={(e) => { if (e.key === 'Enter') { editName = null; onName() } }} />
          {:else}
            <button class="nm b" onclick={() => (editName = 'b')}>{labelB} ✎</button>
          {/if}
        </div>
      </div>

      <!-- Per-team actions -->
      <div class="cols">
        {#each [{ t: 'TEAM_A' as Team, cls: 'a', to: score.timeoutsA, sv: score.serve === 'TEAM_A' }, { t: 'TEAM_B' as Team, cls: 'b', to: score.timeoutsB, sv: score.serve === 'TEAM_B' }] as col}
          <div class="col {col.cls}">
            <button class="serve" class:on={col.sv} onclick={() => serve(col.t)}
                    disabled={score.goalsA > 0 || score.goalsB > 0} title="Aufschlag">⚪ Aufschlag</button>
            <button class="tor {col.cls}" onclick={() => goal(col.t)}>TOR&nbsp;+</button>
            <div class="srow">
              <button class="mini" onclick={() => timeout(col.t)} disabled={col.to >= 2}>Auszeit {col.to}/2</button>
              <button class="mini" onclick={() => reset(col.t)}>Reset</button>
            </div>
          </div>
        {/each}
      </div>

      <div class="grow">
        <button class="mini" onclick={doUndo} disabled={score.matchActions.length === 0}>↶ Rückgängig</button>
        <button class="mini" onclick={finishSet} disabled={!canFinishSet}>Satz beenden</button>
        <button class="mini" onclick={doSwap}>⇄ Seiten tauschen</button>
      </div>

      {#if progress.rows.length}
        <MatchProgress rows={progress.rows} runningSetIndex={progress.runningSetIndex} />
      {/if}

      {#if err}<p class="err">{err}</p>{/if}
      <div class="actions">
        {#if running}
          <button class="primary" onclick={finish}>Beenden</button>
          <button class="ghost small" onclick={park}>Parken</button>
          <button class="danger small" onclick={discard}>Verwerfen</button>
        {:else}
          <button class="primary" onclick={saveEdited}>Speichern</button>
          <button class="ghost small" onclick={cancel}>Abbrechen</button>
        {/if}
      </div>
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
  .fld { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--on-surface-variant); }
  input { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--outline);
    background: var(--surface); color: var(--on-surface); font-size: 16px; }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .nm { background: transparent; border: 0; font-size: 18px; font-weight: 800; cursor: pointer;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nm.a { color: var(--team-a); } .nm.b { color: var(--team-b); }
  .nin { font-size: 16px; padding: 6px 8px; width: 100%; box-sizing: border-box; }
  .setsw { font-size: 12px; color: var(--on-surface-variant); }
  .cur { font-size: 40px; font-weight: 800; line-height: 1; padding: 0 8px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .col { display: flex; flex-direction: column; gap: 8px; }
  .tor { padding: 22px 0; font-size: 22px; font-weight: 800; border: 0; border-radius: 14px;
    color: #fff; cursor: pointer; }
  .tor.a { background: var(--team-a); } .tor.b { background: var(--team-b); }
  .serve { background: transparent; border: 1px solid var(--outline); border-radius: 999px;
    padding: 6px 10px; font-size: 12px; font-weight: 600; color: var(--on-surface-variant); cursor: pointer; }
  .serve.on { color: var(--on-surface); border-color: var(--on-surface); font-weight: 800; }
  .srow { display: flex; gap: 6px; }
  .grow { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .mini { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; flex: 1; }
  .mini:disabled { opacity: .45; cursor: default; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 12px 18px; font-size: 16px; font-weight: 800; cursor: pointer; flex: 1; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
