<script lang="ts">
  // Web port of DailyTimesChartView + OutcomeChartView. Timed entries (Zeitmessung /
  // Zeit & Erfolg) are grouped per CATEGORY into a block, then per time-limit into a
  // section: each measurement is a dot on a 0→limit axis (one row per person). An
  // optional target window per category splits the axis into the desired zone
  // (green), the softer fail zone within the limit (orange) and the foul zone beyond
  // the limit (red); failures are red crosses. Erfolgsquote entries become a per-
  // person success plot with the markers newest-on-the-left and the quote (e.g.
  // "72%") in green when it meets the category's target, else orange.
  import { loadTrainingWindows, type TrainingItem, type TimeWindow, type Ctx } from './data'
  import { secondsLabel, OVERTIME_MS } from './trainingmath'
  import { outcomeTargetOf } from './trainingprefs'
  import { t } from './i18n.svelte'

  let { items, ctx = null }: { items: TrainingItem[]; ctx?: Ctx } = $props()

  let winMeasure = $state<Record<string, TimeWindow>>({})
  let winSuccess = $state<Record<string, TimeWindow>>({})
  $effect(() => {
    const c = ctx
    loadTrainingWindows(c, 'measure').then((w) => { winMeasure = w }).catch(() => {})
    loadTrainingWindows(c, 'measure_success').then((w) => { winSuccess = w }).catch(() => {})
  })

  const DEFAULT = 'Standard'
  type Pt = { ms: number; success: boolean | null }
  type Row = { name: string; pts: Pt[] }
  type Section = { limit: number; rows: Row[] }
  type Block = { title: string; window?: TimeWindow; sections: Section[] }

  // Timed blocks: one per (kind, category). Within a block, sections by limit, rows
  // by person (alphabetical), points chronological (oldest first → newest last).
  const blocks = $derived.by<Block[]>(() => {
    const timed = items.filter((t) => t.kind === 'measure' || t.kind === 'measure_success')
    const byCat = new Map<string, { kind: string; mode: string; items: TrainingItem[] }>()
    for (const t of timed) {
      const mode = t.mode || DEFAULT
      const key = `${t.kind}::${mode}`
      const g = byCat.get(key) ?? { kind: t.kind, mode, items: [] }
      g.items.push(t); byCat.set(key, g)
    }
    const out: Block[] = []
    for (const g of byCat.values()) {
      const limits = [...new Set(g.items.map((t) => t.limitSeconds ?? 0))].sort((a, b) => a - b)
      // entries come newest-first (loadTraining order); reverse so dots read oldest→newest.
      const sections: Section[] = limits.map((limit) => {
        const inLimit = g.items.filter((t) => (t.limitSeconds ?? 0) === limit).slice().reverse()
        const byName = new Map<string, Row>()
        for (const t of inLimit) {
          const name = t.name || '–'
          const r = byName.get(name) ?? { name, pts: [] }
          r.pts.push({ ms: t.elapsedMs ?? 0, success: t.kind === 'measure_success' ? (t.success ?? true) : null })
          byName.set(name, r)
        }
        return { limit, rows: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) }
      })
      const window = g.kind === 'measure' ? winMeasure[g.mode] : winSuccess[g.mode]
      out.push({ title: g.mode, window, sections })
    }
    return out.sort((a, b) => a.title.localeCompare(b.title))
  })

  // Outcome plots: one per (category, person), markers newest-first.
  type Plot = { title: string; name: string; marks: boolean[]; hits: number; total: number; target: number | null }
  const plots = $derived.by<Plot[]>(() => {
    const out = items.filter((t) => t.kind === 'outcome')
    const byKey = new Map<string, { mode: string; name: string; rows: TrainingItem[] }>()
    for (const t of out) {
      const mode = t.mode || DEFAULT, name = t.name || '–'
      const key = `${mode}::${name}`
      const g = byKey.get(key) ?? { mode, name, rows: [] }
      g.rows.push(t); byKey.set(key, g)
    }
    const res: Plot[] = []
    for (const g of byKey.values()) {
      // g.rows are newest-first already; marks newest-on-left = as-is.
      const marks = g.rows.map((t) => !!t.success)
      const hits = marks.filter(Boolean).length
      res.push({ title: g.mode, name: g.name, marks, hits, total: marks.length, target: outcomeTargetOf(ctx, g.mode) })
    }
    return res.sort((a, b) => a.title.localeCompare(b.title) || a.name.localeCompare(b.name))
  })

  // ---- timed-chart geometry (viewBox units) ----------------------------------
  const W = 360, NAME = 92, PAD = 6, TITLE = 20, HEADER = 16, ROW = 30, SGAP = 10, BGAP = 16, FOUL = 0.18
  const axisStart = NAME, axisEnd = W - PAD
  const limitX = axisStart + (axisEnd - axisStart) * (1 - FOUL)
  const xOf = (ms: number, limit: number) => {
    const lm = limit * 1000
    if (ms <= lm) { const f = lm > 0 ? Math.max(0, Math.min(1, ms / lm)) : 0; return axisStart + f * (limitX - axisStart) }
    const over = Math.min(1, (ms - lm) / OVERTIME_MS)
    return limitX + over * (axisEnd - limitX - 4)
  }
  const winMs = (b: Block, limit: number) => {
    const from = b.window?.fromSeconds != null ? b.window.fromSeconds * 1000 : 0
    const to = b.window?.toSeconds != null ? b.window.toSeconds * 1000 : limit * 1000
    const has = b.window?.fromSeconds != null || b.window?.toSeconds != null
    return { from, to, has }
  }
  const sectionH = (s: Section) => HEADER + Math.max(1, s.rows.length) * ROW
  const blockH = (b: Block) => TITLE + b.sections.reduce((h, s, i) => h + (i ? SGAP : 0) + sectionH(s), 0)
  const totalH = $derived(blocks.reduce((h, b, i) => h + (i ? BGAP : 0) + blockH(b), PAD * 2))
  const dotColor = (b: Block, limit: number, p: Pt) => {
    if (p.success === false) return 'var(--bad)'
    if (p.ms > limit * 1000) return 'var(--bad)'
    const { from, to, has } = winMs(b, limit)
    if (has && (p.ms < from || p.ms > to)) return 'var(--warn)'
    return 'var(--ok)'
  }
  // y offset of block bi
  const blockY = (bi: number) => PAD + blocks.slice(0, bi).reduce((h, b) => h + BGAP + blockH(b), 0)
</script>

{#if blocks.length}
  <svg class="chart" viewBox="0 0 {W} {totalH}" preserveAspectRatio="xMinYMin meet" role="img" aria-label={t('chart.times')}>
    {#each blocks as b, bi}
      {@const by = blockY(bi)}
      <text x={PAD} y={by + 14} class="title">{b.title}</text>
      {#each b.sections as s, si}
        {@const yTop = by + TITLE + b.sections.slice(0, si).reduce((h, p) => h + SGAP + sectionH(p), 0)}
        {@const w = winMs(b, s.limit)}
        {@const fromX = xOf(w.from, s.limit)}
        {@const toX = xOf(w.to, s.limit)}
        <text x={axisStart} y={yTop + HEADER - 4} class="axislbl" text-anchor="start">0s</text>
        <text x={limitX} y={yTop + HEADER - 4} class="axislbl" text-anchor="middle">{s.limit}s</text>
        {#if w.has && w.from > 0}<text x={fromX} y={yTop + HEADER - 4} class="axislbl" text-anchor="middle">{secondsLabel(w.from)}</text>{/if}
        {#if w.has && w.to < s.limit * 1000}<text x={toX} y={yTop + HEADER - 4} class="axislbl" text-anchor="middle">{secondsLabel(w.to)}</text>{/if}
        {#each (s.rows.length ? s.rows : [null]) as row, ri}
          {@const cy = yTop + HEADER + ri * ROW + ROW / 2}
          {@const top = cy - ROW / 2 + 2}
          {@const bot = cy + ROW / 2 - 2}
          {#if w.has}
            <rect x={axisStart} y={top} width={Math.max(0, fromX - axisStart)} height={bot - top} rx="3" class="zone warn" />
            <rect x={fromX} y={top} width={Math.max(0, toX - fromX)} height={bot - top} rx="3" class="zone ok" />
            <rect x={toX} y={top} width={Math.max(0, limitX - toX)} height={bot - top} rx="3" class="zone warn" />
          {:else}
            <rect x={axisStart} y={top} width={limitX - axisStart} height={bot - top} rx="3" class="zone ok" />
          {/if}
          <rect x={limitX + 1} y={top} width={axisEnd - limitX - 1} height={bot - top} rx="3" class="zone foul" />
          <line x1={limitX} y1={top - 1} x2={limitX} y2={bot + 1} class="limitline" />
          {#if row}
            <text x={PAD} y={cy + 4} class="name">{row.name}</text>
            {#each row.pts as p}
              {@const x = xOf(p.ms, s.limit)}
              {#if p.success === false}
                <g class="cross"><line x1={x - 5} y1={cy - 5} x2={x + 5} y2={cy + 5} /><line x1={x - 5} y1={cy + 5} x2={x + 5} y2={cy - 5} /></g>
              {:else}
                <circle cx={x} cy={cy} r="4.5" style="fill:{dotColor(b, s.limit, p)}" class="dot" />
              {/if}
            {/each}
          {/if}
        {/each}
      {/each}
    {/each}
  </svg>
{/if}

{#if plots.length}
  <div class="plots">
    {#each plots as p}
      {@const pct = p.total ? Math.round((p.hits / p.total) * 100) : null}
      {@const met = p.target == null || (pct != null && pct >= p.target)}
      {@const quoteW = 60}
      {@const left = 4}
      {@const right = 300 - left - quoteW}
      {@const n = Math.max(1, p.marks.length)}
      <div class="plot">
        <div class="phead"><span class="pname">{p.name}</span>
          <span class="pcat">{p.title}{#if p.target != null} · Ziel {p.target}%{/if}</span></div>
        <svg viewBox="0 0 300 36" class="strip" preserveAspectRatio="none" role="img" aria-label={t('chart.rate')}>
          <rect x={left} y="4" width={right - left} height="28" rx="8" class="area" />
          {#each p.marks as hit, i}
            {@const cx = left + (i + 0.5) / n * (right - left)}
            {#if hit}
              <circle cx={cx} cy="18" r="6" class="mhit" />
            {:else}
              <g class="mmiss"><line x1={cx - 6} y1="12" x2={cx + 6} y2="24" /><line x1={cx - 6} y1="24" x2={cx + 6} y2="12" /></g>
            {/if}
          {/each}
          <text x={right + quoteW / 2} y="23" class="quote" class:met class:miss={!met} text-anchor="middle">{pct == null ? '%' : pct + '%'}</text>
        </svg>
      </div>
    {/each}
  </div>
{/if}

<style>
  .chart { width: 100%; height: auto; display: block; }
  .title { fill: var(--team-a); font-size: 13px; font-weight: 800; }
  .axislbl { fill: var(--on-surface-variant); font-size: 9px; }
  .name { fill: var(--on-surface); font-size: 11px; font-weight: 600; }
  .zone { opacity: .16; }
  .zone.ok { fill: var(--ok); } .zone.warn { fill: var(--warn); } .zone.foul { fill: var(--bad); }
  .limitline { stroke: var(--on-surface-variant); stroke-width: 1; opacity: .5; }
  .dot { opacity: .7; }
  .cross line { stroke: var(--bad); stroke-width: 2.2; stroke-linecap: round; }
  .plots { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
  .plot { background: var(--surface); border: 1px solid var(--outline); border-radius: 12px; padding: 8px 12px 4px; }
  .phead { display: flex; justify-content: space-between; align-items: baseline; font-size: 13px; }
  .pname { font-weight: 700; }
  .pcat { color: var(--on-surface-variant); font-size: 12px; }
  .strip { width: 100%; height: 36px; display: block; }
  .area { fill: var(--ok); opacity: .13; }
  .mhit { fill: none; stroke: var(--ok); stroke-width: 2.4; }
  .mmiss line { stroke: var(--bad); stroke-width: 2.4; stroke-linecap: round; }
  .quote { font-size: 16px; font-weight: 800; fill: var(--on-surface); }
  .quote.met { fill: var(--ok); } .quote.miss { fill: var(--warn); }
</style>
