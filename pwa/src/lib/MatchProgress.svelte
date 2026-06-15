<script lang="ts">
  // A faithful web port of the Android MatchProgressView: one row per set on a
  // soft rounded background, the set result on the left (team A blue above the
  // axis, team B green below), and the goal-by-goal timeline next to it — the
  // most recent goal next to the result, the oldest at the far right. Team A's
  // counter boxes ride above the axis, team B's below, so they leapfrog. The
  // running set carries a "LIVE" badge and a colour-wabbling "Kuller" marble at
  // the next-goal slot. The axis scrolls horizontally when it overflows.
  import { PROG, neededUsable, rowXs, type ProgRow } from './match'

  let { rows, runningSetIndex }: { rows: ProgRow[]; runningSetIndex: number } = $props()

  const P = PROG
  const usable = $derived(neededUsable(rows, runningSetIndex))
  const allXs = $derived(rows.map((r, i) => rowXs(r, i, runningSetIndex, usable)))
  const axisStart = P.rowInset + P.labelWidth
  const width = $derived.by(() => {
    let maxCenter = P.boxW / 2
    for (const xs of allXs) for (const x of xs) maxCenter = Math.max(maxCenter, x)
    return Math.ceil(axisStart + maxCenter + P.boxW / 2 + P.rowInset)
  })
  const height = $derived(rows.length * P.rowHeight + Math.max(0, rows.length - 1) * P.rowGap)
  const rowY = (i: number) => i * (P.rowHeight + P.rowGap)
  const centerY = (i: number) => rowY(i) + P.rowHeight / 2
  const visibleEnd = $derived(width - P.rowInset)
</script>

<div class="prog-scroll">
  <svg {width} {height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Satzverlauf">
    {#each rows as row, i}
      {@const cy = centerY(i)}
      {@const xs = allXs[i]}
      <!-- soft rounded per-set background -->
      <rect class="rowbg" x="0" y={rowY(i)} width={width} height={P.rowHeight} rx="12" />
      <!-- sticky-ish left column: set label, LIVE badge, result -->
      <text class="setlabel" x={P.rowInset} y={cy - 14} dominant-baseline="middle">Satz {i + 1}</text>
      {#if row.live}
        <text class="livelabel" x={P.rowInset} y={cy + 4} dominant-baseline="middle">LIVE</text>
      {/if}
      <text class="scoreA" x={axisStart - P.scoreInset} y={cy - P.laneOffset} text-anchor="end" dominant-baseline="middle">{row.goalsA}</text>
      <text class="scoreB" x={axisStart - P.scoreInset} y={cy + P.laneOffset} text-anchor="end" dominant-baseline="middle">{row.goalsB}</text>
      <!-- the axis track -->
      <line class="track" x1={axisStart} y1={cy} x2={visibleEnd} y2={cy} />
      <!-- the Kuller (next-goal marble) for the running set -->
      {#if i === runningSetIndex}
        <circle class="kuller" cx={axisStart + P.boxW / 2} cy={cy} r={P.kullerRadius} />
      {/if}
      <!-- goal counter boxes: team A above the axis, team B below -->
      {#each row.goals as g, gi}
        {@const gx = axisStart + xs[gi]}
        {@const gy = cy + (g.team === 'A' ? -P.laneOffset : P.laneOffset)}
        <g class="box" class:a={g.team === 'A'} class:b={g.team === 'B'}>
          <rect x={gx - P.boxW / 2} y={gy - P.boxH / 2} width={P.boxW} height={P.boxH} rx={P.boxRadius} />
          <text x={gx} y={gy} text-anchor="middle" dominant-baseline="central">{g.label}</text>
        </g>
      {/each}
    {/each}
  </svg>
</div>

<style>
  .prog-scroll { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;
    margin: 0 -4px; padding: 0 4px; }
  svg { display: block; }
  .rowbg { fill: var(--on-surface); opacity: 0.07; }
  .setlabel { fill: var(--on-surface-variant); font-size: 12px;
    font-family: "Roboto Condensed", system-ui, sans-serif; }
  .livelabel { fill: var(--live); font-size: 11px; font-weight: 700; letter-spacing: .08em;
    font-family: "Roboto Condensed", system-ui, sans-serif; }
  .scoreA, .scoreB { font-size: 26px; font-weight: 700; letter-spacing: -.5px;
    font-family: "Roboto Condensed", system-ui, sans-serif; }
  .scoreA { fill: var(--team-a); }
  .scoreB { fill: var(--team-b); }
  .track { stroke: var(--outline-variant); stroke-width: 1.5; }
  .box.a rect { fill: var(--team-a); }
  .box.b rect { fill: var(--team-b); }
  .box text { fill: #fff; font-size: 13px; font-weight: 700;
    font-family: "Roboto Condensed", system-ui, sans-serif; }
  .kuller { fill: var(--team-a); transform-box: fill-box; transform-origin: center;
    animation: wabble 1.5s ease-in-out infinite, breathe 1.5s ease-in-out -0.375s infinite; }
  @keyframes wabble { 0%, 100% { fill: var(--team-a); } 50% { fill: var(--team-b); } }
  @keyframes breathe { 0%, 100% { transform: scale(0.82); } 50% { transform: scale(1.2); } }
  @media (prefers-reduced-motion: reduce) {
    .kuller { animation: none; }
  }
</style>
