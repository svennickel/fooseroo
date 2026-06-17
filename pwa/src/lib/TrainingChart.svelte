<script lang="ts">
  // Web port of DailyTimesChartView + the outcome quota. Measured times are plotted
  // as dots (crosses for failures in Zeit & Erfolg) on a 0→limit axis per time-limit
  // "section", one row per person; the zone within the limit is green, beyond it red
  // (foul). Outcome entries become a hit-rate bar per person.
  import type { TrainingItem } from './data'

  let { items }: { items: TrainingItem[] } = $props()

  type Row = { name: string; times: number[]; successes: (boolean | null)[] }
  type Section = { limit: number; rows: Row[] }

  // measure + measure_success → sections by limit (seconds), rows by person.
  const sections = $derived.by<Section[]>(() => {
    const timed = items.filter((t) => t.kind === 'measure' || t.kind === 'measure_success')
    const limits = [...new Set(timed.map((t) => t.limitSeconds ?? 0))].sort((a, b) => a - b)
    return limits.map((limit) => {
      const inLimit = timed.filter((t) => (t.limitSeconds ?? 0) === limit)
      const byName = new Map<string, Row>()
      for (const t of inLimit) {
        const name = t.name || '–'
        const r = byName.get(name) ?? { name, times: [], successes: [] }
        r.times.push(t.elapsedMs ?? 0)
        r.successes.push(t.kind === 'measure_success' ? (t.success ?? true) : null)
        byName.set(name, r)
      }
      return { limit, rows: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }
    })
  })

  const outcomes = $derived.by(() => {
    const out = items.filter((t) => t.kind === 'outcome')
    const byName = new Map<string, { name: string; hits: number; total: number }>()
    for (const t of out) {
      const name = t.name || '–'
      const r = byName.get(name) ?? { name, hits: 0, total: 0 }
      r.total++; if (t.success) r.hits++
      byName.set(name, r)
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
  })

  // SVG geometry (viewBox units; the SVG scales to the container width).
  const W = 360, NAME = 96, PAD = 6, HEADER = 16, ROW = 30, GAP = 12, FOUL = 0.18
  const axisStart = NAME, axisEnd = W - PAD, axisW = axisEnd - axisStart
  const limitX = axisStart + axisW * (1 - FOUL)
  const xOf = (ms: number, limit: number) => {
    const lm = limit * 1000
    const f = lm > 0 ? Math.min(1, Math.max(0, ms / lm)) : 0
    return axisStart + f * (limitX - axisStart)
  }
  const sectionHeight = (s: Section) => HEADER + Math.max(1, s.rows.length) * ROW
  const totalHeight = $derived(sections.reduce((h, s, i) => h + (i ? GAP : 0) + sectionHeight(s), PAD * 2))
</script>

{#if sections.length}
  <svg class="chart" viewBox="0 0 {W} {totalHeight}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Trainingszeiten">
    {#each sections as s, si}
      {@const yTop = PAD + sections.slice(0, si).reduce((h, p) => h + GAP + sectionHeight(p), 0)}
      <text x={axisStart} y={yTop + HEADER - 4} class="axislbl" text-anchor="start">0s</text>
      <text x={limitX} y={yTop + HEADER - 4} class="axislbl" text-anchor="middle">{s.limit}s</text>
      {#each (s.rows.length ? s.rows : [null]) as row, ri}
        {@const cy = yTop + HEADER + ri * ROW + ROW / 2}
        <rect x={axisStart} y={cy - ROW / 2 + 2} width={limitX - axisStart} height={ROW - 4} rx="3" class="zone ok" />
        <rect x={limitX + 1} y={cy - ROW / 2 + 2} width={axisEnd - limitX - 1} height={ROW - 4} rx="3" class="zone foul" />
        <line x1={limitX} y1={cy - ROW / 2 + 1} x2={limitX} y2={cy + ROW / 2 - 1} class="limitline" />
        {#if row}
          <text x={PAD} y={cy + 4} class="name">{row.name}</text>
          {#each row.times as ms, i}
            {@const x = xOf(ms, s.limit)}
            {#if row.successes[i] === false}
              <g class="cross"><line x1={x - 4} y1={cy - 4} x2={x + 4} y2={cy + 4} /><line x1={x - 4} y1={cy + 4} x2={x + 4} y2={cy - 4} /></g>
            {:else}
              <circle cx={x} cy={cy} r="4" class="dot" />
            {/if}
          {/each}
        {/if}
      {/each}
    {/each}
  </svg>
{/if}

{#if outcomes.length}
  <div class="quotas">
    {#each outcomes as o}
      <div class="q">
        <div class="qhead"><span class="qname">{o.name}</span><span class="qval">{o.hits}/{o.total} · {Math.round((o.hits / o.total) * 100)}%</span></div>
        <div class="qbar"><div class="qfill" style="width:{(o.hits / o.total) * 100}%"></div></div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .chart { width: 100%; height: auto; display: block; }
  .axislbl { fill: var(--on-surface-variant); font-size: 9px; }
  .name { fill: var(--on-surface); font-size: 11px; font-weight: 600; }
  .zone { opacity: .16; }
  .zone.ok { fill: var(--ok); }
  .zone.foul { fill: var(--bad); }
  .limitline { stroke: var(--on-surface-variant); stroke-width: 1; opacity: .5; }
  .dot { fill: var(--team-a); }
  .cross line { stroke: var(--bad); stroke-width: 2; stroke-linecap: round; }
  .quotas { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .q { background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 8px 12px; }
  .qhead { display: flex; justify-content: space-between; font-size: 13px; }
  .qname { font-weight: 600; }
  .qval { color: var(--on-surface-variant); }
  .qbar { margin-top: 6px; height: 8px; background: var(--surface-variant); border-radius: 999px; overflow: hidden; }
  .qfill { height: 100%; background: var(--ok); }
</style>
