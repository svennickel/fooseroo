<script lang="ts">
  // A faithful canvas port of the Android MatchProgressView. One row per set on a
  // soft rounded background; the set result sticks on the left (team A blue above
  // the axis, team B green below) and the goal timeline sits next to it — most
  // recent goal next to the result, oldest at the far right. Team A's counter
  // boxes ride above the axis, team B's below, so they leapfrog. The running set
  // carries a "LIVE" badge and a colour-wabbling "Kuller" marble at the next-goal
  // slot. Only the AXIS scrolls (internally, sticky left column stays put) with a
  // soft edge fade where goals are hidden; the page still scrolls vertically.
  //
  // Transitions mirror the native view exactly: a scored goal grows out of the
  // Kuller and rises into its lane (320 ms, ease-out-back) while the others slide
  // to their new slots; an undo reverses it; a finished set fades in as a whole
  // while the Kuller jumps down from the just-finished set and the LIVE badge
  // cross-fades (620 ms); undoing a set end plays in reverse.
  import { onMount } from 'svelte'
  import { PROG, neededUsable, rowXs, type ProgRow, type ProgGoal } from './match'

  let { rows, runningSetIndex }: { rows: ProgRow[]; runningSetIndex: number } = $props()

  const { rowHeight, rowGap, rowInset, labelWidth, boxW, boxH, boxRadius,
    laneOffset, kullerRadius } = PROG
  const fadeLen = 24
  const WABBLE = 1500, ANIM_DUR = 320, SET_ANIM_DUR = 620

  let cvs: HTMLCanvasElement
  let ctx: CanvasRenderingContext2D | null = null
  let layer: HTMLCanvasElement | null = null
  let lctx: CanvasRenderingContext2D | null = null
  let cssW = 0, cssH = 0, dpr = 1
  let raf = 0
  let mounted = false
  let reduced = false

  // scroll / fling
  let scrollXAxis = 0, maxScrollX = 0
  let dragging = false, decided = false
  let downX = 0, downY = 0, lastX = 0
  let velScroll = 0, lastMoveMs = 0, flinging = false, lastFlingMs = 0

  // transition state (mirrors the native fields)
  let prevRunningKeys = new Set<number>()
  let prevRunningGoals: ProgGoal[] = []
  let prevGoalX = new Map<number, number>()
  let prevRows: ProgRow[] = []
  let animProgress = 1, animStartMs = 0
  let enteringIndex = -1
  let exiting: ProgGoal | null = null
  let exitingLabel = 0, exitingFromX = NaN
  let prevRunningSetIndex = -1, prevRowCount = 0
  let setAnimProgress = 1, setAnimStartMs = 0, setAnimReverse = false
  let ghostRow: ProgRow | null = null

  let col = {
    teamA: '#1565C0', teamB: '#2E7D32', onSurface: '#1A1C1E',
    onSurfaceVar: '#44474E', outlineVar: '#C4C6CF', onAccent: '#fff', live: '#E53935'
  }

  const clock = () => performance.now()
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2)
  const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const easeOutBack = (t: number) => { const c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u }

  function parseHex(h: string): [number, number, number] {
    h = h.trim().replace('#', '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const n = parseInt(h, 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  function lerpColor(a: string, b: string, t: number): string {
    const [r1, g1, b1] = parseHex(a), [r2, g2, b2] = parseHex(b)
    return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`
  }

  function resolveColors() {
    if (!cvs) return
    const s = getComputedStyle(cvs)
    const g = (n: string, fb: string) => (s.getPropertyValue(n).trim() || fb)
    col = {
      teamA: g('--team-a', '#1565C0'), teamB: g('--team-b', '#2E7D32'),
      onSurface: g('--on-surface', '#1A1C1E'), onSurfaceVar: g('--on-surface-variant', '#44474E'),
      outlineVar: g('--outline-variant', '#C4C6CF'), onAccent: g('--on-accent', '#fff'),
      live: g('--live', '#E53935')
    }
  }

  function sync() {
    if (!cvs || !layer) return
    const w = cvs.clientWidth
    const h = rows.length * rowHeight + Math.max(0, rows.length - 1) * rowGap
    if (w <= 0) return
    cssW = w; cssH = h
    cvs.style.height = `${h}px`
    dpr = Math.min(window.devicePixelRatio || 1, 3)
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr)
    layer.width = cvs.width; layer.height = cvs.height
    ctx = cvs.getContext('2d'); lctx = layer.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    lctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(draw) }

  function startAnim() { animProgress = 0; animStartMs = clock() }
  function resetAnim() { animProgress = 1; enteringIndex = -1; exiting = null; prevGoalX.clear() }
  const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((k) => b.has(k))

  // Mirrors MatchProgressView.setData: detect a single goal added / removed in the
  // running set (animate in/out of the Kuller) and a set advance / undo.
  function applyData() {
    const newRunning = (runningSetIndex >= 0 ? rows[runningSetIndex]?.goals : undefined) ?? []
    const newKeys = new Set(newRunning.map((g) => g.idx))
    if (runningSetIndex < 0 || runningSetIndex >= rows.length) {
      resetAnim()
    } else if (newKeys.size === prevRunningKeys.size + 1 && [...prevRunningKeys].every((k) => newKeys.has(k))) {
      enteringIndex = [...newKeys].find((k) => !prevRunningKeys.has(k)) ?? -1
      exiting = null
      startAnim()
    } else if (newKeys.size === prevRunningKeys.size - 1 && [...newKeys].every((k) => prevRunningKeys.has(k))) {
      const gone = [...prevRunningKeys].find((k) => !newKeys.has(k)) ?? -1
      exiting = prevRunningGoals.find((g) => g.idx === gone) ?? null
      exitingLabel = prevRunningGoals.filter((g) => g.team === exiting?.team && g.idx <= gone).length
      exitingFromX = prevGoalX.get(gone) ?? NaN
      enteringIndex = -1
      startAnim()
    } else if (!sameSet(newKeys, prevRunningKeys)) {
      resetAnim()
    }
    prevRunningKeys = newKeys
    prevRunningGoals = newRunning

    const setAdvanced = prevRunningSetIndex >= 0 && prevRunningSetIndex < runningSetIndex &&
      runningSetIndex === prevRunningSetIndex + 1 && rows.length === prevRowCount + 1 &&
      runningSetIndex === rows.length - 1
    const setReverted = runningSetIndex >= 0 && runningSetIndex === prevRunningSetIndex - 1 &&
      rows.length === prevRowCount - 1 && prevRunningSetIndex === prevRowCount - 1
    if (setAdvanced || setReverted) {
      setAnimProgress = 0; setAnimStartMs = clock(); setAnimReverse = setReverted
      ghostRow = setReverted ? (prevRows[prevRunningSetIndex] ?? null) : null
    }
    prevRunningSetIndex = runningSetIndex
    prevRowCount = rows.length
    prevRows = rows

    scrollXAxis = 0; flinging = false
    sync(); schedule()
  }

  function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath(); c.roundRect(x, y, w, h, r)
  }
  function drawGoalBox(c: CanvasRenderingContext2D, cx: number, cy: number, scale: number, teamA: boolean, label: number) {
    c.save()
    if (scale !== 1) { c.translate(cx, cy); c.scale(scale, scale); c.translate(-cx, -cy) }
    roundRect(c, cx - boxW / 2, cy - boxH / 2, boxW, boxH, boxRadius)
    c.fillStyle = teamA ? col.teamA : col.teamB
    c.fill()
    c.fillStyle = col.onAccent
    c.font = '700 13px "Roboto Condensed", system-ui, sans-serif'
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'
    c.fillText(String(label), cx, cy + 13 / 3)
    c.restore()
  }
  function drawLive(c: CanvasRenderingContext2D, x: number, y: number, alpha: number) {
    c.save()
    c.globalAlpha *= alpha
    c.fillStyle = col.live
    c.font = '700 11px "Roboto Condensed", system-ui, sans-serif'
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'
    try { c.letterSpacing = '0.9px' } catch { /* older browsers */ }
    c.fillText('LIVE', x, y)
    c.restore()
  }

  function draw() {
    raf = 0
    if (!ctx || !lctx || !layer || cssW <= 0 || rows.length === 0) return
    const c = ctx, lc = lctx
    const now = clock()
    const innerStart = rowInset
    const axisStart = innerStart + labelWidth
    const visibleEnd = cssW - rowInset

    // layout (shared usable axis width; fills the viewport when content is sparse)
    const usable = Math.max(neededUsable(rows, runningSetIndex), visibleEnd - axisStart - boxW)
    const rowXsAll = rows.map((row, i) => rowXs(row, i, runningSetIndex, usable).map((x) => axisStart + x))
    let contentRight = visibleEnd
    for (const xs of rowXsAll) for (const x of xs) contentRight = Math.max(contentRight, x + boxW / 2)
    maxScrollX = Math.max(0, contentRight - visibleEnd)

    // momentum scroll
    if (flinging) {
      const dt = (now - lastFlingMs) / 1000; lastFlingMs = now
      scrollXAxis += velScroll * dt
      velScroll *= Math.pow(0.0025, dt)
      if (Math.abs(velScroll) < 20 || scrollXAxis <= 0 || scrollXAxis >= maxScrollX) flinging = false
    }
    scrollXAxis = clamp(scrollXAxis, 0, maxScrollX)

    // Kuller wabble (colour smootherstep blue<->green; size breathes a quarter-phase ahead)
    const phase = 2 * Math.PI * ((now % WABBLE) / WABBLE)
    const wabbleColor = reduced ? 0.5 : smoother(0.5 + 0.5 * Math.sin(phase))
    const wabbleSize = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(phase + Math.PI / 2)
    const kullerR = kullerRadius * (0.78 + 0.44 * wabbleSize)
    const kullerColor = lerpColor(col.teamA, col.teamB, wabbleColor)

    if (animProgress < 1) animProgress = clamp((now - animStartMs) / ANIM_DUR, 0, 1)
    const animE = easeInOut(animProgress)
    if (setAnimProgress < 1) setAnimProgress = clamp((now - setAnimStartMs) / SET_ANIM_DUR, 0, 1)
    const setAnimE = smoother(setAnimProgress)
    const setTransitioning = setAnimProgress < 1 && runningSetIndex > 0

    c.clearRect(0, 0, cssW, cssH)
    lc.clearRect(0, 0, cssW, cssH)
    lc.save()
    lc.beginPath(); lc.rect(axisStart, 0, visibleEnd - axisStart, cssH); lc.clip()

    let oldRunCenterY = NaN, newRunCenterY = NaN, jumpKullerX = NaN
    let runningTargets: Map<number, number> | null = null
    let y = 0
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]
      const cy = y + rowHeight / 2
      const newSetFade = setTransitioning && !setAnimReverse && index === runningSetIndex
      const rowAlpha = newSetFade ? setAnimE : 1

      // soft rounded per-set background
      c.globalAlpha = 0.07 * rowAlpha
      c.fillStyle = col.onSurface
      roundRect(c, 0, y, cssW, rowHeight, 12); c.fill()
      c.globalAlpha = 1

      if (index === runningSetIndex) { newRunCenterY = cy; jumpKullerX = axisStart + boxW / 2 }
      if (index === runningSetIndex - 1) oldRunCenterY = cy

      // sticky column: set label
      c.globalAlpha = rowAlpha
      c.fillStyle = col.onSurfaceVar
      c.font = '12px "Roboto Condensed", system-ui, sans-serif'
      c.textAlign = 'left'; c.textBaseline = 'alphabetic'
      try { c.letterSpacing = '0px' } catch { /* noop */ }
      c.fillText(`Satz ${index + 1}`, innerStart, cy - 14)

      // LIVE badge (cross-fades during a set transition)
      if (index === runningSetIndex) {
        drawLive(c, innerStart, cy + 4, setTransitioning && setAnimReverse ? setAnimE : 1)
      } else if (setTransitioning && !setAnimReverse && index === runningSetIndex - 1) {
        drawLive(c, innerStart, cy + 4, 1 - setAnimE)
      }

      // set result, each number aligned with its team's lane
      c.globalAlpha = rowAlpha
      c.font = '700 26px "Roboto Condensed", system-ui, sans-serif'
      c.textAlign = 'right'; c.textBaseline = 'alphabetic'
      c.fillStyle = col.teamA; c.fillText(String(row.goalsA), axisStart - 20, cy - laneOffset + 26 / 3)
      c.fillStyle = col.teamB; c.fillText(String(row.goalsB), axisStart - 20, cy + laneOffset + 26 / 3)

      // axis track
      c.globalAlpha = rowAlpha
      c.strokeStyle = col.outlineVar; c.lineWidth = 1.5
      c.beginPath(); c.moveTo(axisStart, cy); c.lineTo(visibleEnd, cy); c.stroke()
      c.globalAlpha = 1

      // axis content → offscreen layer (clipped + edge-faded)
      const isRunning = index === runningSetIndex
      const xs = rowXsAll[index]
      const kullerX = isRunning ? axisStart + boxW / 2 : NaN
      if (isRunning) runningTargets = new Map(row.goals.map((g, i) => [g.idx, xs[i]]))
      lc.globalAlpha = rowAlpha
      // Kuller first (so a counter growing out of it draws on top); during a set
      // transition the running Kuller is drawn by the cross-row jump overlay.
      if (!Number.isNaN(kullerX) && !(setTransitioning && isRunning)) {
        lc.fillStyle = kullerColor
        lc.beginPath(); lc.arc(kullerX - scrollXAxis, cy, kullerR, 0, 2 * Math.PI); lc.fill()
      }
      const animating = isRunning && animProgress < 1
      for (let gi = 0; gi < row.goals.length; gi++) {
        const goal = row.goals[gi]
        const isA = goal.team === 'A'
        const laneSign = isA ? -1 : 1
        const targetX = xs[gi]
        let drawX = targetX, laneFrac = 1, scale = 1
        if (animating) {
          if (goal.idx === enteringIndex) {
            const pop = easeOutBack(animProgress)
            drawX = lerp(kullerX, targetX, animE)
            laneFrac = pop
            scale = 0.35 + 0.65 * pop
          } else {
            drawX = lerp(prevGoalX.get(goal.idx) ?? targetX, targetX, animE)
          }
        }
        const cx = drawX - scrollXAxis
        const cyy = cy + laneSign * laneOffset * laneFrac
        drawGoalBox(lc, cx, cyy, scale, isA, goal.label)
      }
      // undo: the removed counter slides back down into the Kuller
      if (animating && exiting) {
        const isA = exiting.team === 'A'
        const laneSign = isA ? -1 : 1
        const startX = Number.isNaN(exitingFromX) ? kullerX : exitingFromX
        const cx = lerp(startX, kullerX, animE) - scrollXAxis
        const cyy = cy + laneSign * laneOffset * (1 - animE)
        drawGoalBox(lc, cx, cyy, 1 - 0.6 * animE, isA, exitingLabel)
      }
      lc.globalAlpha = 1
      y += rowHeight + rowGap
    }

    // edge fades on the axis layer (erase goals toward a scrolled-away edge)
    if (scrollXAxis > 0.5) {
      const g = lc.createLinearGradient(axisStart, 0, axisStart + fadeLen, 0)
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)')
      lc.globalCompositeOperation = 'destination-out'
      lc.fillStyle = g; lc.fillRect(axisStart, 0, fadeLen, cssH)
      lc.globalCompositeOperation = 'source-over'
    }
    if (scrollXAxis < maxScrollX - 0.5) {
      const g = lc.createLinearGradient(visibleEnd - fadeLen, 0, visibleEnd, 0)
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)')
      lc.globalCompositeOperation = 'destination-out'
      lc.fillStyle = g; lc.fillRect(visibleEnd - fadeLen, 0, fadeLen, cssH)
      lc.globalCompositeOperation = 'source-over'
    }
    lc.restore()
    c.drawImage(layer, 0, 0, cssW, cssH)

    // reverse (undo): the removed set lingers a frame as a ghost below, fading out
    let ghostCenterY = NaN
    if (setTransitioning && setAnimReverse && ghostRow) {
      const gy = y; ghostCenterY = gy + rowHeight / 2
      const a = 1 - setAnimE
      c.globalAlpha = 0.07 * a
      c.fillStyle = col.onSurface; roundRect(c, 0, gy, cssW, rowHeight, 12); c.fill()
      c.globalAlpha = a
      c.fillStyle = col.onSurfaceVar; c.font = '12px "Roboto Condensed", system-ui, sans-serif'
      c.textAlign = 'left'; c.textBaseline = 'alphabetic'
      c.fillText(`Satz ${rows.length + 1}`, innerStart, ghostCenterY - 14)
      drawLive(c, innerStart, ghostCenterY + 4, 1)
      c.font = '700 26px "Roboto Condensed", system-ui, sans-serif'; c.textAlign = 'right'
      c.fillStyle = col.teamA; c.fillText(String(ghostRow.goalsA), axisStart - 20, ghostCenterY - laneOffset + 26 / 3)
      c.fillStyle = col.teamB; c.fillText(String(ghostRow.goalsB), axisStart - 20, ghostCenterY + laneOffset + 26 / 3)
      c.strokeStyle = col.outlineVar; c.lineWidth = 1.5
      c.beginPath(); c.moveTo(axisStart, ghostCenterY); c.lineTo(visibleEnd, ghostCenterY); c.stroke()
      c.globalAlpha = 1
    }

    // the Kuller jumps across the row gap between the just-finished and running set
    if (setTransitioning && !Number.isNaN(newRunCenterY) && !Number.isNaN(jumpKullerX)) {
      const fromY = setAnimReverse ? ghostCenterY : oldRunCenterY
      if (!Number.isNaN(fromY)) {
        const jy = lerp(fromY, newRunCenterY, setAnimE)
        c.fillStyle = kullerColor
        c.beginPath(); c.arc(jumpKullerX - scrollXAxis, jy, kullerR, 0, 2 * Math.PI); c.fill()
      }
    }

    // capture resting positions for the next transition once settled
    if (animProgress >= 1) {
      if (runningTargets) { prevGoalX = runningTargets }
      enteringIndex = -1; exiting = null
    }

    const live = runningSetIndex >= 0 && runningSetIndex < rows.length
    if ((live && !reduced) || setAnimProgress < 1 || animProgress < 1 || flinging) schedule()
  }

  // ── pointer / wheel: scroll only the axis, leave vertical paging to the page ──
  function onPointerDown(e: PointerEvent) {
    flinging = false
    downX = e.clientX; downY = e.clientY; lastX = e.clientX
    decided = false; dragging = false
    velScroll = 0; lastMoveMs = clock()
  }
  function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - downX, dy = e.clientY - downY
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      decided = true
      dragging = maxScrollX > 0 && Math.abs(dx) > Math.abs(dy)
      lastX = e.clientX
      if (dragging) cvs.setPointerCapture(e.pointerId)
    }
    if (!dragging) return
    e.preventDefault()
    const now = clock()
    const dxStep = lastX - e.clientX
    const prev = scrollXAxis
    scrollXAxis = clamp(scrollXAxis + dxStep, 0, maxScrollX)
    const dt = (now - lastMoveMs) / 1000
    if (dt > 0) velScroll = (scrollXAxis - prev) / dt
    lastX = e.clientX; lastMoveMs = now
    schedule()
  }
  function endPointer(e: PointerEvent) {
    if (dragging) {
      try { cvs.releasePointerCapture(e.pointerId) } catch { /* noop */ }
      if (Math.abs(velScroll) > 80 && maxScrollX > 0) { flinging = true; lastFlingMs = clock(); schedule() }
    }
    dragging = false; decided = false
  }
  function onWheel(e: WheelEvent) {
    if (maxScrollX <= 0) return
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
    if (d === 0) return
    e.preventDefault()
    scrollXAxis = clamp(scrollXAxis + d, 0, maxScrollX)
    schedule()
  }

  onMount(() => {
    mounted = true
    layer = document.createElement('canvas')   // offscreen axis layer (edge fades)
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resolveColors(); sync()
    const ro = new ResizeObserver(() => { sync(); schedule() })
    ro.observe(cvs)
    const mqDark = window.matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => { resolveColors(); schedule() }
    mqDark.addEventListener('change', onTheme)
    cvs.addEventListener('wheel', onWheel, { passive: false })
    applyData()
    return () => {
      ro.disconnect()
      mqDark.removeEventListener('change', onTheme)
      cvs.removeEventListener('wheel', onWheel)
      if (raf) cancelAnimationFrame(raf)
    }
  })

  // Re-run the native setData diff whenever the data changes.
  $effect(() => {
    rows; runningSetIndex
    if (mounted) applyData()
  })
</script>

<canvas
  bind:this={cvs}
  class="prog"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endPointer}
  onpointercancel={endPointer}
  aria-label="Satzverlauf"
></canvas>

<style>
  .prog { display: block; width: 100%; height: 76px; touch-action: pan-y; }
</style>
