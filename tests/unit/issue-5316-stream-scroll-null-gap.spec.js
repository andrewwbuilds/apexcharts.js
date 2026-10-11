import { describe, it, expect } from 'vitest'
import { createChartWithOptions } from './utils/utils.js'

/**
 * #5316: a null splits a line or area series into segments, and since #3249
 * those segments are subpaths of ONE path element. A rolling-window update
 * under `xaxis.range` is a stream scroll, which morphs from the new path
 * projected into the previous frame's pixel space. That projection read the
 * first segment only, so the morph started with fewer subpaths than it ended
 * with, and the segment after the gap grew in from the left edge on every
 * update instead of sliding left with the rest of the line.
 */

const STEP = 1000
const N = 20
const T0 = Date.UTC(2026, 0, 1)
const GAP = T0 + 14 * STEP

/** The window after `s` ticks: N points, one null at GAP while it is inside. */
const windowAt = (s) =>
  Array.from({ length: N }, (_, k) => {
    const x = T0 + (s + k) * STEP
    return [x, x === GAP ? null : 40 + ((s + k) % 7) * 5]
  })

function render(type, curve) {
  const chart = createChartWithOptions({
    chart: { type, width: 700, height: 300 },
    dataLabels: { enabled: false },
    markers: { size: 0 },
    stroke: { curve },
    xaxis: { type: 'datetime', range: (N - 1) * STEP },
    yaxis: { min: 0, max: 100 },
    series: [{ name: 'v', data: windowAt(0) }],
  })
  // Mounted without animations, then switched on so the update morphs.
  chart.w.config.chart.animations.enabled = true
  return chart
}

/** The coordinate pairs of each subpath (one per M) of a path string. */
const subpaths = (d) =>
  d
    .split(/(?=M)/)
    .filter((s) => s.trim())
    .map((s) => {
      const n = (s.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi) || []).map(
        Number,
      )
      const pts = []
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]])
      return pts
    })

describe('Issue 5316: stream scroll with a null gap', () => {
  it.each([
    ['line', 'straight'],
    ['line', 'smooth'],
    ['area', 'straight'],
    ['area', 'smooth'],
  ])(
    '%s (%s): every segment slides one step instead of growing in',
    async (type, curve) => {
      const chart = render(type, curve)
      await chart.updateSeries([{ data: windowAt(1) }])
      expect(chart.w.globals.streamScrolled).toBe(true)

      const el = document.querySelector(`.apexcharts-${type}`)
      const from = subpaths(el.getAttribute('pathFrom'))
      const to = subpaths(el.getAttribute('pathTo'))

      // the gap splits the path, and both ends of the morph carry every part
      expect(to.length).toBeGreaterThan(1)
      expect(from.length).toBe(to.length)

      // each point starts where the previous frame drew it: one step right
      const stepPx = chart.w.layout.gridWidth / (N - 1)
      to.forEach((seg, i) => {
        expect(from[i].length).toBe(seg.length)
        seg.forEach(([x, y], k) => {
          expect(from[i][k][0] - x).toBeCloseTo(stepPx, 1)
          expect(from[i][k][1]).toBeCloseTo(y, 1)
        })
      })
      chart.destroy()
    },
  )
})
