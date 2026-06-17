<script lang="ts">
  // Full match scoring editor — the web port of the app's match counter. Creates a
  // NEW match (team/category setup → live scoring) or edits an existing one, with
  // every action: Tor, Aufschlag, Auszeit, Reset, Rückgängig, Satz beenden,
  // Seitentausch. While live it is the editor on the broadcast channel (pushes each
  // change; a newer claim takes over from the app) and writes the byte-identical
  // matches row. Park / Beenden / Verwerfen mirror the app.
  import { applyAction, undo, swapSides, replaceActions, emptyScore, setsWonFromGames,
    type ScoreState, type Team, type ActionType } from './scoring'
  import { saveMatchRow, discardMatchRow } from './matchstore'
  import { createLiveEditor, liveChannelId, type LiveEditor } from './livematch'
  import { parseMatchState, progressRows } from './match'
  import { encodeMatch } from './share'
  import { isIOS } from './platform'
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
  // Editing reopens the match into the running counter (like the app's "Bearbeiten"),
  // so the screen is always the live counter; "Spielende" finishes it.
  let running = $state(true)
  let menuOpen = $state(false)        // three-dot overflow
  let askEnd = $state(false)          // "Spiel beenden?" confirmation
  let askDelete = $state(false)       // "Löschen…" confirmation
  const ROD_SHORT = 10, ROD_LONG = 15 // the 10s / 15s countdown buttons
  let progressEl: HTMLElement | undefined = $state()
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
  // Shot-clock countdown after actions, like the app's match counter: goal 5s,
  // timeout 30s, set finished 90s; idle = "Bereit".
  const CD_GOAL = 5, CD_TIMEOUT = 30, CD_SET = 90
  let cdTotal = $state(0), cdRemaining = $state(0), cdRunning = $state(false)
  let cdTick: ReturnType<typeof setInterval> | null = null
  function startCountdown(seconds: number) {
    if (cdTick) clearInterval(cdTick)
    cdTotal = seconds * 1000; cdRemaining = cdTotal; cdRunning = true
    const end = Date.now() + cdTotal
    cdTick = setInterval(() => {
      cdRemaining = Math.max(0, end - Date.now())
      if (cdRemaining <= 0) { if (cdTick) clearInterval(cdTick); cdTick = null; cdRunning = false; try { navigator.vibrate?.(200) } catch { /* ignore */ } }
    }, 50)
  }
  function stopCountdown() { if (cdTick) clearInterval(cdTick); cdTick = null; cdRunning = false }

  // Apply a change. While live (new / running): broadcast + debounce-persist. While
  // editing a FINISHED match: change locally only — persist on explicit "Speichern"
  // so "Abbrechen" truly reverts (and never deletes the match).
  function change(next: ScoreState | null) { if (!next) return; score = next; if (running) { pushLive(); scheduleSave() } }
  function act(team: Team, type: ActionType, cd?: number) {
    const n = applyAction(score, team, type); if (!n) return
    change(n); if (cd) startCountdown(cd)
  }
  const goal = (t: Team) => act(t, 'GOAL', CD_GOAL)
  const serve = (t: Team) => act(t, 'SERVE')
  const timeout = (t: Team) => act(t, 'TIMEOUT', CD_TIMEOUT)
  const reset = (t: Team) => act(t, 'RESET')
  const finishSet = () => act('NONE', 'GAME_FINISHED', CD_SET)
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

  function cleanup() { if (saveTimer) clearTimeout(saveTimer); stopCountdown(); editor?.leave(); editor = null }
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
  async function discard() {
    if (saveTimer) clearTimeout(saveTimer)
    try { await discardMatchRow(ctx, ts) } catch { err = 'Verwerfen fehlgeschlagen.'; return }
    editor?.end(null, true); cleanup(); onSaved(); onClose()
  }
  function cancel() { cleanup(); onClose() }

  // "Spielende" → confirm; with goals it is archived (finish), without it is
  // discarded (abandon) — exactly the app's matchEndRequest.
  const hasGoals = $derived(score.matchActions.some((a) => a.type === 'GOAL'))
  function endConfirmed() { askEnd = false; if (hasGoals) finish(); else discard() }

  // Per-team stats line (timeouts + reset state + "Auflage"), exact app wording.
  function statsLine(team: 'A' | 'B'): string {
    const to = team === 'A' ? score.timeoutsA : score.timeoutsB
    const rs = team === 'A' ? score.resetStateA : score.resetStateB
    const toStr = to === 1 ? '1 Timeout\n' : to === 2 ? '2 Timeouts\n' : ''
    const rsStr = rs === 'RESET' ? 'Reset\n' : rs === 'RESET_WARNING' ? 'Reset Warning\n'
      : rs === 'RESET_VIOLATION' ? 'Reset Violation\n' : ''
    const serving = score.serve === (team === 'A' ? 'TEAM_A' : 'TEAM_B')
    return toStr + rsStr + (serving ? 'Auflage' : '')
  }

  async function shareMatch() {
    menuOpen = false
    if (!ctx) return
    const url = `${location.origin}/m/${encodeMatch(ctx, ts)}`
    if (navigator.share) { try { await navigator.share({ title: `${labelA} : ${labelB}`, url }) } catch { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(url) } catch { /* ignore */ } }
  }
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
      <!-- Toolbar like the app's match counter: back (parks), Spielverlauf, Rückgängig,
           Seiten tauschen, and the three-dot overflow (Teilen, Löschen…). -->
      <div class="toolbar">
        <button class="tbtn" onclick={park} aria-label="Zurück">{isIOS ? '‹' : '←'}</button>
        <div class="tactions">
          <button class="tbtn" onclick={() => progressEl?.scrollIntoView({ behavior: 'smooth' })} title="Spielverlauf" aria-label="Spielverlauf">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.26,3C8.17,2.86 4,6.95 4,12L2.21,12c-0.45,0 -0.67,0.54 -0.35,0.85l2.79,2.8c0.2,0.2 0.51,0.2 0.71,0l2.79,-2.8c0.31,-0.31 0.09,-0.85 -0.36,-0.85L6,12c0,-3.9 3.18,-7.05 7.1,-7 3.72,0.05 6.85,3.18 6.9,6.9 0.05,3.91 -3.1,7.1 -7,7.1 -1.61,0 -3.1,-0.55 -4.28,-1.48 -0.4,-0.31 -0.96,-0.28 -1.32,0.08 -0.42,0.42 -0.39,1.13 0.08,1.49C9,20.29 10.91,21 13,21c5.05,0 9.14,-4.17 9,-9.26 -0.13,-4.69 -4.05,-8.61 -8.74,-8.74zM12.75,8c-0.41,0 -0.75,0.34 -0.75,0.75v3.68c0,0.35 0.19,0.68 0.49,0.86l3.12,1.85c0.36,0.21 0.82,0.09 1.03,-0.26 0.21,-0.36 0.09,-0.82 -0.26,-1.03l-2.88,-1.71v-3.4c0,-0.4 -0.34,-0.74 -0.75,-0.74z"/></svg>
          </button>
          <button class="tbtn" onclick={doUndo} disabled={score.matchActions.length === 0} title="Rückgängig" aria-label="Rückgängig">↶</button>
          <button class="tbtn" onclick={doSwap} title="Seiten tauschen" aria-label="Seiten tauschen">⇄</button>
          <div class="ovwrap">
            <button class="tbtn" onclick={() => (menuOpen = !menuOpen)} aria-label="Mehr">{isIOS ? '•••' : '⋮'}</button>
            {#if menuOpen && !isIOS}
              <!-- Android/desktop: top-right dropdown -->
              <button class="catch" aria-label="Schließen" onclick={() => (menuOpen = false)}></button>
              <div class="ovmenu" role="menu">
                {#if ctx}<button role="menuitem" onclick={shareMatch}>Teilen</button>{/if}
                <button role="menuitem" class="del" onclick={() => { menuOpen = false; askDelete = true }}>Löschen…</button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Countdown row: [10s] [Bereit / countdown] [15s] -->
      <div class="cdrow">
        <button class="rod" onclick={() => startCountdown(ROD_SHORT)}>{ROD_SHORT}s</button>
        <div class="cd" class:run={cdRunning} class:warn={cdRunning && cdRemaining < cdTotal * 0.35}>
          {cdRunning ? `${(cdRemaining / 1000).toFixed(1)}` : 'Bereit'}
          {#if cdRunning}<div class="cdc">{Math.round(cdTotal / 1000)}s Countdown</div>{/if}
        </div>
        <button class="rod" onclick={() => startCountdown(ROD_LONG)}>{ROD_LONG}s</button>
      </div>

      <!-- Names + set score -->
      <div class="hero">
        <div class="side a">
          {#if editName === 'a'}
            <input class="nin" bind:value={teamA} onblur={() => { editName = null; onName() }}
                   onkeydown={(e) => { if (e.key === 'Enter') { editName = null; onName() } }} />
          {:else}
            <button class="nm a" onclick={() => (editName = 'a')}>{labelA}</button>
          {/if}
        </div>
        <div class="cur">{sets.a} : {sets.b}</div>
        <div class="side b">
          {#if editName === 'b'}
            <input class="nin" bind:value={teamB} onblur={() => { editName = null; onName() }}
                   onkeydown={(e) => { if (e.key === 'Enter') { editName = null; onName() } }} />
          {:else}
            <button class="nm b" onclick={() => (editName = 'b')}>{labelB}</button>
          {/if}
        </div>
      </div>

      <!-- Per-team small buttons: Auflage · Reset · Timeout | Timeout · Reset · Auflage -->
      <div class="btn6">
        <button class="sb" class:on={score.serve === 'TEAM_A'} onclick={() => serve('TEAM_A')}>Auflage</button>
        <button class="sb" onclick={() => reset('TEAM_A')}>Reset</button>
        <button class="sb" onclick={() => timeout('TEAM_A')} disabled={score.timeoutsA >= 2}>Timeout</button>
        <button class="sb" onclick={() => timeout('TEAM_B')} disabled={score.timeoutsB >= 2}>Timeout</button>
        <button class="sb" onclick={() => reset('TEAM_B')}>Reset</button>
        <button class="sb" class:on={score.serve === 'TEAM_B'} onclick={() => serve('TEAM_B')}>Auflage</button>
      </div>

      <!-- Tor | Satzende | Tor -->
      <div class="goalrow">
        <button class="tor a" onclick={() => goal('TEAM_A')}>Tor</button>
        <button class="finish" onclick={finishSet} disabled={!canFinishSet}>Satzende</button>
        <button class="tor b" onclick={() => goal('TEAM_B')}>Tor</button>
      </div>

      <div class="statsrow"><div class="stats">{statsLine('A')}</div><div class="stats">{statsLine('B')}</div></div>

      <div bind:this={progressEl}>
        {#if progress.rows.length}
          <MatchProgress rows={progress.rows} runningSetIndex={progress.runningSetIndex} />
        {/if}
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if askDelete}
        <div class="confirm"><p>Match löschen?</p>
          <div class="crow"><button class="danger small" onclick={discard}>Löschen</button><button class="ghost small" onclick={() => (askDelete = false)}>Abbrechen</button></div></div>
      {:else if askEnd}
        <div class="confirm"><p><strong>Spiel beenden?</strong><br>{hasGoals ? 'Ergebnis und Spielverlauf werden gespeichert.' : 'Ohne Tore wird das Spiel verworfen.'}</p>
          <div class="crow"><button class="primary" onclick={endConfirmed}>Spielende</button><button class="ghost small" onclick={() => (askEnd = false)}>Abbrechen</button></div></div>
      {:else}
        <button class="primary end" onclick={() => (askEnd = true)}>Spielende</button>
      {/if}

      {#if menuOpen && isIOS}
        <!-- iOS: a bottom action sheet instead of a top-right dropdown -->
        <div class="sheetwrap" role="presentation">
          <button class="sheetbg" aria-label="Schließen" onclick={() => (menuOpen = false)}></button>
          <div class="actionsheet" role="menu">
            {#if ctx}<button role="menuitem" onclick={shareMatch}>Teilen</button>{/if}
            <button role="menuitem" class="del" onclick={() => { menuOpen = false; askDelete = true }}>Löschen…</button>
            <button role="menuitem" class="cancel" onclick={() => (menuOpen = false)}>Abbrechen</button>
          </div>
        </div>
      {/if}
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
  /* Toolbar (match counter) */
  .toolbar { display: flex; align-items: center; justify-content: space-between; }
  .tactions { display: flex; align-items: center; gap: 2px; }
  .tbtn { background: transparent; border: 0; color: var(--on-surface-variant); cursor: pointer;
    width: 40px; height: 40px; border-radius: 50%; font-size: 20px; display: inline-flex;
    align-items: center; justify-content: center; }
  .tbtn:disabled { opacity: .4; cursor: default; }
  .tbtn svg { width: 22px; height: 22px; }
  .ovwrap { position: relative; }
  .catch { position: fixed; inset: 0; z-index: 60; background: transparent; border: 0; }
  .ovmenu { position: absolute; top: calc(100% + 4px); right: 0; z-index: 61; background: var(--surface);
    border: 1px solid var(--outline); border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18);
    min-width: 160px; overflow: hidden; }
  .ovmenu button { display: block; width: 100%; text-align: left; background: transparent; border: 0;
    padding: 12px 16px; font-size: 15px; color: var(--on-surface); cursor: pointer; }
  .ovmenu button.del { color: var(--bad); }
  /* Countdown row */
  .cdrow { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; }
  .rod { background: var(--surface); border: 1px solid var(--outline); border-radius: 10px;
    padding: 8px 12px; font-size: 14px; font-weight: 700; color: var(--on-surface); cursor: pointer; }
  .cd { text-align: center; font-size: 26px; font-weight: 800; color: var(--on-surface-variant); line-height: 1.05; }
  .cd.run { color: var(--team-a); } .cd.warn { color: var(--live); }
  .cdc { font-size: 11px; font-weight: 600; color: var(--on-surface-variant); }
  /* Per-team small buttons */
  .btn6 { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4px; }
  .sb { background: transparent; border: 1px solid var(--outline); border-radius: 8px;
    padding: 8px 2px; font-size: 12px; font-weight: 600; color: var(--on-surface); cursor: pointer; }
  .sb.on { border-color: var(--on-surface); font-weight: 800; }
  .sb:disabled { opacity: .4; cursor: default; }
  /* Tor | Satzende | Tor */
  .goalrow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: stretch; }
  .tor { padding: 24px 0; font-size: 22px; font-weight: 800; border: 0; border-radius: 14px;
    color: #fff; cursor: pointer; }
  .tor.a { background: var(--team-a); } .tor.b { background: var(--team-b); }
  .finish { background: var(--surface); border: 1px solid var(--outline); border-radius: 14px;
    padding: 0 14px; font-size: 14px; font-weight: 700; color: var(--on-surface); cursor: pointer; }
  .finish:disabled { opacity: .4; cursor: default; }
  .statsrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stats { font-size: 12px; color: var(--on-surface-variant); white-space: pre-line; min-height: 16px; }
  .stats:last-child { text-align: right; }
  .primary { background: var(--team-a); color: var(--on-accent); border: 0; border-radius: 12px;
    padding: 12px 18px; font-size: 16px; font-weight: 800; cursor: pointer; }
  .primary.end { align-self: stretch; }
  .ghost.small { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .danger.small { background: transparent; color: var(--bad); border: 1px solid var(--bad);
    border-radius: 10px; padding: 9px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
  /* iOS action sheet */
  .sheetwrap { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-end; }
  .sheetbg { position: absolute; inset: 0; background: rgba(0,0,0,.35); border: 0; }
  .actionsheet { position: relative; width: 100%; max-width: 440px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 1px; padding: 8px 8px calc(8px + env(safe-area-inset-bottom, 0px));
    background: transparent; }
  .actionsheet button { background: var(--surface); border: 0; padding: 16px; font-size: 17px;
    color: var(--team-a); cursor: pointer; }
  .actionsheet button:first-child { border-radius: 12px 12px 0 0; }
  .actionsheet button.del { color: var(--bad); }
  .actionsheet button.cancel { border-radius: 12px; margin-top: 8px; font-weight: 700; color: var(--on-surface); }
  .confirm { background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 12px 14px; }
  .confirm p { margin: 0 0 8px; font-size: 14px; }
  .crow { display: flex; gap: 8px; }
  /* iOS convention: cancel sits left of the action (DOM order is action→cancel) */
  :global(html.ios) .crow { flex-direction: row-reverse; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
