<script lang="ts">
  // Web port of DaySummaryFragment + PersonReportFragment. Two read-only evaluations
  // over the training (and, for the day summary, the matches):
  //   view="day"    → everything recorded on ONE day, newest first, charts per category.
  //   view="person" → all trainings of ONE person, grouped by day (newest first),
  //                   with a "frühere anzeigen" pager.
  // Sharing mirrors the match share (Web Share API: a short text + a deep link when
  // in a group); a rendered PNG export like the app is a follow-up.
  import TrainingChart from './TrainingChart.svelte'
  import { dayKey, type TrainingItem, type MatchItem, type Ctx } from './data'
  import { encodeTraining } from './share'

  let { view, ctx, items, matches, persons, onClose, onChanged }:
    { view: 'day' | 'person'; ctx: Ctx; items: TrainingItem[]; matches: MatchItem[]
      persons: string[]; onClose: () => void; onChanged?: () => void } = $props()

  void onChanged
  // Days that actually have training or matches, newest first.
  const days = $derived.by(() => {
    const set = new Set<string>()
    for (const t of items) set.add(dayKey(t.at))
    for (const m of matches) set.add(dayKey(m.at))
    return [...set].sort((a, b) => b.localeCompare(a))
  })
  // People with at least one training entry, alphabetical.
  const people = $derived.by(() => {
    const set = new Set<string>()
    for (const t of items) if (t.name) set.add(t.name)
    for (const p of persons) set.add(p)
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  })

  let day = $state('')
  let person = $state('')
  $effect(() => { if (view === 'day' && !day && days.length) day = days[0] })
  $effect(() => { if (view === 'person' && !person && people.length) person = people[0] })

  let shownDays = $state(1)     // person report: how many days are expanded

  function label(key: string): string {
    const y = +key.slice(0, 4), mo = +key.slice(4, 6) - 1, d = +key.slice(6, 8)
    const date = new Date(y, mo, d)
    const today = dayKey(Date.now())
    const yest = dayKey(Date.now() - 86400000)
    if (key === today) return 'Heute'
    if (key === yest) return 'Gestern'
    return date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const dayItems = $derived(items.filter((t) => dayKey(t.at) === day))
  const dayMatches = $derived(matches.filter((m) => dayKey(m.at) === day))

  // Person report: that person's entries grouped by day (newest first).
  const personDays = $derived.by(() => {
    const mine = items.filter((t) => t.name === person)
    const map = new Map<string, TrainingItem[]>()
    for (const t of mine) { const k = dayKey(t.at); (map.get(k) ?? map.set(k, []).get(k)!).push(t) }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  })

  let pickingDay = $state(false)
  let pickingPerson = $state(false)

  async function share() {
    const title = view === 'day' ? `Tagesauswertung – ${label(day)}` : `Einzelauswertung – ${person}`
    let text = title
    if (view === 'day') {
      const n = dayItems.length, m = dayMatches.length
      text += `\n${n} Trainingseinträge` + (m ? `, ${m} Begegnungen` : '')
    } else {
      text += `\n${items.filter((t) => t.name === person).length} Trainingseinträge`
    }
    // In a group, append the deep link to the shared day (mirrors the app's token).
    let url: string | undefined
    if (ctx && view === 'day') {
      const dn = +day.slice(0, 4) * 10000 + +day.slice(4, 6) * 100 + +day.slice(6, 8)
      url = `${location.origin}${location.pathname}#/t/${encodeTraining(ctx, dn)}`
    }
    try {
      if (navigator.share) await navigator.share({ title, text, url })
      else { await navigator.clipboard.writeText(text + (url ? `\n${url}` : '')); flash() }
    } catch { /* cancelled */ }
  }
  let copied = $state(false)
  function flash() { copied = true; setTimeout(() => (copied = false), 1500) }
</script>

<div class="overlay" role="presentation">
  <div class="sheet">
    <div class="head">
      <strong>{view === 'day' ? 'Tagesauswertung' : 'Einzelauswertung'}</strong>
      <div class="hbtns">
        <button class="ghost" onclick={share}>Teilen</button>
        <button class="ghost" onclick={onClose}>Schließen</button>
      </div>
    </div>
    {#if copied}<p class="note">In die Zwischenablage kopiert</p>{/if}

    {#if view === 'day'}
      <button class="sel" onclick={() => (pickingDay = true)}>{day ? label(day) : 'Tag wählen'} ▾</button>
      {#if dayItems.length === 0 && dayMatches.length === 0}
        <p class="hint">Kein Training und keine Begegnungen an diesem Tag.</p>
      {:else}
        <TrainingChart items={dayItems} {ctx} />
        {#if dayMatches.length}
          <h4 class="sub">Begegnungen</h4>
          <ul class="list">
            {#each dayMatches as m}
              <li class="mcard"><span class="mteams">{m.homeName} : {m.awayName}</span>
                <span class="msets">{m.setsHome}:{m.setsAway}</span></li>
            {/each}
          </ul>
        {/if}
      {/if}
    {:else}
      <button class="sel" onclick={() => (pickingPerson = true)}>{person || 'Person wählen'} ▾</button>
      {#if personDays.length === 0}
        <p class="hint">Keine Trainingsergebnisse für diese Person.</p>
      {:else}
        {#each personDays.slice(0, shownDays) as [k, list]}
          <h4 class="sub">{label(k)}</h4>
          <TrainingChart items={list} {ctx} />
        {/each}
        {#if shownDays < personDays.length}
          <button class="ghost wide" onclick={() => (shownDays += 1)}>Frühere anzeigen</button>
        {/if}
      {/if}
    {/if}

    {#if pickingDay}
      <div class="picker" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) pickingDay = false }}>
        <div class="psheet"><strong>Tag</strong>
          {#each days as d}
            <button class="prow" class:on={d === day} onclick={() => { day = d; pickingDay = false }}>{d === day ? '✓ ' : ''}{label(d)}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if pickingPerson}
      <div class="picker" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) pickingPerson = false }}>
        <div class="psheet"><strong>Person</strong>
          {#each people as p}
            <button class="prow" class:on={p === person} onclick={() => { person = p; shownDays = 1; pickingPerson = false }}>{p === person ? '✓ ' : ''}{p}</button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 945; background: rgba(0,0,0,.5);
    display: flex; align-items: flex-end; justify-content: center; }
  .sheet { width: 100%; max-width: 440px; max-height: 94vh; overflow-y: auto; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 12px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .head strong { font-size: 17px; }
  .hbtns { display: flex; gap: 6px; }
  .sel { align-self: flex-start; background: var(--surface); border: 1px solid var(--team-a); border-radius: 999px;
    padding: 9px 16px; font-size: 14px; font-weight: 700; color: var(--on-surface); cursor: pointer; }
  .sub { margin: 6px 0 0; font-size: 13px; color: var(--on-surface-variant); font-weight: 700; }
  .hint { font-size: 13px; color: var(--on-surface-variant); }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .mcard { display: flex; justify-content: space-between; background: var(--surface); border: 1px solid var(--outline);
    border-radius: 10px; padding: 9px 12px; font-size: 14px; }
  .msets { font-weight: 800; }
  .note { color: var(--ok); font-weight: 700; margin: 0; font-size: 13px; }
  .ghost { background: transparent; color: var(--team-a); border: 1px solid var(--outline);
    border-radius: 8px; padding: 7px 12px; font-size: 13px; font-weight: 700; cursor: pointer; }
  .ghost.wide { align-self: stretch; padding: 11px; }
  .picker { position: fixed; inset: 0; z-index: 980; background: rgba(0,0,0,.45);
    display: flex; align-items: flex-end; justify-content: center; }
  .psheet { width: 100%; max-width: 440px; max-height: 70vh; overflow-y: auto; background: var(--bg);
    border-radius: 18px 18px 0 0; display: flex; flex-direction: column; gap: 4px;
    padding: 14px 16px calc(16px + env(safe-area-inset-bottom, 0px)); }
  .psheet strong { font-size: 16px; margin-bottom: 6px; }
  .prow { text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--outline);
    padding: 12px 4px; font-size: 15px; color: var(--on-surface); cursor: pointer; }
  .prow.on { color: var(--team-a); font-weight: 700; }
</style>
