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
  import { addPlayersToPool, type MatchItem } from './data'
  import MatchProgress from './MatchProgress.svelte'
  import ChoicePicker from './ChoicePicker.svelte'
  import { t } from './i18n.svelte'
  import { onMount } from 'svelte'

  let { mode, ctx, myUserId, initial, pool, categorySuggestions, defaultCategory, peerMatches, onClose, onSaved }:
    { mode: 'new' | 'edit'; ctx: string | null; myUserId: string | null; initial?: MatchItem | null
      pool: string[]; categorySuggestions: string[]; defaultCategory: string; peerMatches: MatchItem[]
      onClose: () => void; onSaved: () => void } = $props()

  // The match counter is always the live scoring screen — a new match opens straight
  // into it (in the current category), like the app's "Neues Match".
  let poolState = $state<string[]>([...pool])
  let picking = $state<'a' | 'b' | 'cat' | null>(null)  // open chip picker for a side / category
  const TEAM_SEP = ' & '
  const parseTeam = (s: string) => s.split(TEAM_SEP).map((x) => x.trim()).filter(Boolean)
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
  // Only persist once the match has CONTENT (an action or a named team) — opening
  // and abandoning a fresh match must not litter the list with a "– vs – 0:0" row.
  const hasContent = $derived(score.matchActions.length > 0 || !!teamA.trim() || !!teamB.trim())
  function scheduleSave() {
    if (!hasContent) return
    if (saveTimer) clearTimeout(saveTimer)
    // Surface a persistent live-save failure instead of swallowing it — otherwise a
    // match that never reaches the cloud (RLS/offline) just silently disappears.
    saveTimer = setTimeout(() => { saveRow(running).then(() => { err = '' }).catch(() => { err = t('me.not_saved') }) }, 1200)
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

  // A new match opens straight into the counter: stamp it, become the live editor.
  // We do NOT persist yet — only the first action or picked team writes the row, so
  // an opened-then-abandoned match never litters the list with a "– vs – 0:0" row.
  function start() {
    if (mode !== 'new') return
    ts = Date.now(); running = true
    startLiveEditor()
  }
  onMount(() => { if (mode === 'new') start() })
  // For editing an already-running match, take over as the live editor.
  $effect(() => { if (running && !editor && mode === 'edit') startLiveEditor() })

  // Team chips: 1–2 players joined by " & " (like the app's teamLabel). Picking a
  // team applies the selection; new names are added to the synced pool.
  function applyTeam(side: 'a' | 'b', picked: string[]) {
    const label = picked.slice(0, 2).join(TEAM_SEP)
    if (side === 'a') teamA = label; else teamB = label
    onName()
  }
  async function addToPool(name: string) {
    if (!poolState.includes(name)) poolState = [...poolState, name]
    try { poolState = await addPlayersToPool(ctx, [name]) } catch { /* keep local */ }
  }
  // Today's involvement per player in THIS category (count shown on the chips).
  const todayKey = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` }
  const involvement = $derived.by(() => {
    const m: Record<string, number> = {}
    for (const x of peerMatches) {
      const dk = (() => { const d = new Date(x.at); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` })()
      if (dk !== todayKey() || (x.category ?? '') !== category) continue
      for (const n of new Set([...parseTeam(x.homeName), ...parseTeam(x.awayName)])) m[n] = (m[n] ?? 0) + 1
    }
    return m
  })

  function cleanup() { if (saveTimer) clearTimeout(saveTimer); stopCountdown(); editor?.leave(); editor = null }
  async function finish() {
    if (saveTimer) clearTimeout(saveTimer)
    try { running = false; await saveRow(false) } catch { err = t('training.save_failed'); return }
    editor?.end(JSON.stringify(score), false); cleanup(); onSaved(); onClose()
  }
  async function park() {
    if (saveTimer) clearTimeout(saveTimer)
    if (!hasContent) { cleanup(); onClose(); return }   // nothing to keep
    try { await saveRow(true) } catch { err = t('training.save_failed'); return }
    cleanup(); onSaved(); onClose()   // row stays running; editor stops broadcasting
  }
  async function discard() {
    if (saveTimer) clearTimeout(saveTimer)
    try { await discardMatchRow(ctx, ts) } catch { err = t('me.discard_failed'); return }
    editor?.end(null, true); cleanup(); onSaved(); onClose()
  }
  // "Spielende" → confirm; with goals it is archived (finish), without it is
  // discarded (abandon) — exactly the app's matchEndRequest.
  const hasGoals = $derived(score.matchActions.some((a) => a.type === 'GOAL'))
  function endConfirmed() { askEnd = false; if (hasGoals) finish(); else discard() }

  // Per-team stats line (timeouts + reset state + "Auflage"), exact app wording.
  function statsLine(team: 'A' | 'B'): string {
    const to = team === 'A' ? score.timeoutsA : score.timeoutsB
    const rs = team === 'A' ? score.resetStateA : score.resetStateB
    const toStr = to === 1 ? `${t('me.timeouts_1')}\n` : to === 2 ? `${t('me.timeouts_2')}\n` : ''
    const rsStr = rs === 'RESET' ? `${t('me.reset')}\n` : rs === 'RESET_WARNING' ? `${t('me.reset_warning')}\n`
      : rs === 'RESET_VIOLATION' ? `${t('me.reset_violation')}\n` : ''
    const serving = score.serve === (team === 'A' ? 'TEAM_A' : 'TEAM_B')
    return toStr + rsStr + (serving ? t('me.serve') : '')
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
      <!-- Toolbar like the app's match counter: back (parks), Spielverlauf, Rückgängig,
           Seiten tauschen, and the three-dot overflow (Teilen, Löschen…). -->
      <div class="toolbar">
        <button class="tbtn" onclick={park} aria-label={t('common.back_word')}>{isIOS ? '‹' : '←'}</button>
        <div class="tactions">
          <button class="tbtn" onclick={() => progressEl?.scrollIntoView({ behavior: 'smooth' })} title={t('me.history')} aria-label={t('me.history')}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.26,3C8.17,2.86 4,6.95 4,12L2.21,12c-0.45,0 -0.67,0.54 -0.35,0.85l2.79,2.8c0.2,0.2 0.51,0.2 0.71,0l2.79,-2.8c0.31,-0.31 0.09,-0.85 -0.36,-0.85L6,12c0,-3.9 3.18,-7.05 7.1,-7 3.72,0.05 6.85,3.18 6.9,6.9 0.05,3.91 -3.1,7.1 -7,7.1 -1.61,0 -3.1,-0.55 -4.28,-1.48 -0.4,-0.31 -0.96,-0.28 -1.32,0.08 -0.42,0.42 -0.39,1.13 0.08,1.49C9,20.29 10.91,21 13,21c5.05,0 9.14,-4.17 9,-9.26 -0.13,-4.69 -4.05,-8.61 -8.74,-8.74zM12.75,8c-0.41,0 -0.75,0.34 -0.75,0.75v3.68c0,0.35 0.19,0.68 0.49,0.86l3.12,1.85c0.36,0.21 0.82,0.09 1.03,-0.26 0.21,-0.36 0.09,-0.82 -0.26,-1.03l-2.88,-1.71v-3.4c0,-0.4 -0.34,-0.74 -0.75,-0.74z"/></svg>
          </button>
          <button class="tbtn" onclick={doUndo} disabled={score.matchActions.length === 0} title={t('me.undo')} aria-label={t('me.undo')}>↶</button>
          <button class="tbtn" onclick={doSwap} title={t('me.swap')} aria-label={t('me.swap')}>⇄</button>
          <div class="ovwrap">
            <button class="tbtn" onclick={() => (menuOpen = !menuOpen)} aria-label={t('me.more')}>{isIOS ? '•••' : '⋮'}</button>
            {#if menuOpen && !isIOS}
              <!-- Android/desktop: top-right dropdown -->
              <button class="catch" aria-label="Schließen" onclick={() => (menuOpen = false)}></button>
              <div class="ovmenu" role="menu">
                {#if ctx}<button role="menuitem" onclick={shareMatch}>{t('eval.share')}</button>{/if}
                <button role="menuitem" class="del" onclick={() => { menuOpen = false; askDelete = true }}>{t('me.delete_dots')}</button>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Category chip (tap to change), like the app counter's category chip. -->
      <div class="catrow">
        <button class="catchip" onclick={() => (picking = 'cat')}>{category || defaultCategory}</button>
      </div>

      <!-- Countdown row: [10s] [Bereit / countdown] [15s] -->
      <div class="cdrow">
        <button class="rod" onclick={() => startCountdown(ROD_SHORT)}>{ROD_SHORT}s</button>
        <div class="cd" class:run={cdRunning} class:warn={cdRunning && cdRemaining < cdTotal * 0.35}>
          {cdRunning ? `${(cdRemaining / 1000).toFixed(1)}` : t('me.ready')}
          {#if cdRunning}<div class="cdc">{t('me.countdown', Math.round(cdTotal / 1000))}</div>{/if}
        </div>
        <button class="rod" onclick={() => startCountdown(ROD_LONG)}>{ROD_LONG}s</button>
      </div>

      <!-- Names + set score. Tapping a side opens the player chip picker (1–2). -->
      <div class="hero">
        <div class="side a">
          <button class="nm a" onclick={() => (picking = 'a')}>{labelA}</button>
        </div>
        <div class="cur">{sets.a} : {sets.b}</div>
        <div class="side b">
          <button class="nm b" onclick={() => (picking = 'b')}>{labelB}</button>
        </div>
      </div>

      <!-- Per-team small buttons: Auflage · Reset · Timeout | Timeout · Reset · Auflage -->
      <div class="btn6">
        <button class="sb" class:on={score.serve === 'TEAM_A'} onclick={() => serve('TEAM_A')}>{t('me.serve')}</button>
        <button class="sb" onclick={() => reset('TEAM_A')}>{t('me.reset')}</button>
        <button class="sb" onclick={() => timeout('TEAM_A')} disabled={score.timeoutsA >= 2}>{t('me.timeout')}</button>
        <button class="sb" onclick={() => timeout('TEAM_B')} disabled={score.timeoutsB >= 2}>{t('me.timeout')}</button>
        <button class="sb" onclick={() => reset('TEAM_B')}>{t('me.reset')}</button>
        <button class="sb" class:on={score.serve === 'TEAM_B'} onclick={() => serve('TEAM_B')}>{t('me.serve')}</button>
      </div>

      <!-- Tor | Satzende | Tor -->
      <div class="goalrow">
        <button class="tor a" onclick={() => goal('TEAM_A')}>{t('me.goal')}</button>
        <button class="finish" onclick={finishSet} disabled={!canFinishSet}>{t('me.set_end')}</button>
        <button class="tor b" onclick={() => goal('TEAM_B')}>{t('me.goal')}</button>
      </div>

      <div class="statsrow"><div class="stats">{statsLine('A')}</div><div class="stats">{statsLine('B')}</div></div>

      <div bind:this={progressEl}>
        {#if progress.rows.length}
          <MatchProgress rows={progress.rows} runningSetIndex={progress.runningSetIndex} />
        {/if}
      </div>

      {#if err}<p class="err">{err}</p>{/if}

      {#if askDelete}
        <div class="confirm"><p>{t('me.delete_q')}</p>
          <div class="crow"><button class="danger small" onclick={discard}>{t('common.delete')}</button><button class="ghost small" onclick={() => (askDelete = false)}>{t('common.cancel')}</button></div></div>
      {:else if askEnd}
        <div class="confirm"><p><strong>{t('me.end_q')}</strong><br>{hasGoals ? t('me.end_save') : t('me.end_discard')}</p>
          <div class="crow"><button class="primary" onclick={endConfirmed}>{t('me.match_end')}</button><button class="ghost small" onclick={() => (askEnd = false)}>{t('common.cancel')}</button></div></div>
      {:else}
        <button class="primary end" onclick={() => (askEnd = true)}>{t('me.match_end')}</button>
      {/if}

      {#if menuOpen && isIOS}
        <!-- iOS: a bottom action sheet instead of a top-right dropdown -->
        <div class="sheetwrap" role="presentation">
          <button class="sheetbg" aria-label={t('common.close')} onclick={() => (menuOpen = false)}></button>
          <div class="actionsheet" role="menu">
            {#if ctx}<button role="menuitem" onclick={shareMatch}><svg class="shareglyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2l3.5 3.5-1.4 1.4L13 5.8V15h-2V5.8L9.9 6.9 8.5 5.5 12 2z"/><path fill="currentColor" d="M6 10h2v9h8v-9h2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9z"/></svg> {t('eval.share')}</button>{/if}
            <button role="menuitem" class="del" onclick={() => { menuOpen = false; askDelete = true }}>{t('me.delete_dots')}</button>
            <button role="menuitem" class="cancel" onclick={() => (menuOpen = false)}>{t('common.cancel')}</button>
          </div>
        </div>
      {/if}

      {#if picking}
        <ChoicePicker
          title={picking === 'cat' ? t('training.category') : (picking === 'a' ? t('me.team_left') : t('me.team_right'))}
          items={picking === 'cat' ? categorySuggestions : poolState}
          selected={picking === 'cat' ? [category] : (picking === 'a' ? parseTeam(teamA) : parseTeam(teamB))}
          maxSelection={picking === 'cat' ? 1 : 2}
          counts={picking === 'cat' ? {} : involvement}
          allowAdd={picking !== 'cat'}
          onAdd={(n) => addToPool(n)}
          onPicked={(names) => {
            if (picking === 'cat') { category = names[0] ?? category; scheduleSave() }
            else if (picking === 'a' || picking === 'b') applyTeam(picking, names)
          }}
          onClose={() => (picking = null)} />
      {/if}
  </div>
</div>

<style>
  /* Full-screen like the Android match counter (not a bottom sheet) — it needs the room. */
  .overlay { position: fixed; inset: 0; z-index: 940; background: var(--bg);
    display: flex; align-items: stretch; justify-content: center; }
  .sheet { width: 100%; max-width: 480px; height: 100%; overflow-y: auto; background: var(--bg);
    border-radius: 0; display: flex; flex-direction: column; gap: 12px;
    padding: calc(12px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .hero { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .nm { background: transparent; border: 0; font-size: 18px; font-weight: 800; cursor: pointer;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nm.a { color: var(--team-a); } .nm.b { color: var(--team-b); }
  .cur { font-size: 40px; font-weight: 800; line-height: 1; padding: 0 8px; }
  /* Toolbar (match counter) */
  .toolbar { display: flex; align-items: center; justify-content: space-between; }
  .catrow { display: flex; justify-content: center; }
  .catchip { background: var(--surface); border: 1px solid var(--outline); border-radius: 999px;
    padding: 6px 14px; font-size: 13px; font-weight: 600; color: var(--on-surface); cursor: pointer; }
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
  /* iOS share glyph inline in the action-sheet "Teilen" row */
  .shareglyph { width: 18px; height: 18px; vertical-align: -3px; margin-right: 4px; }
  .err { color: var(--bad); font-size: 13px; margin: 0; }
</style>
