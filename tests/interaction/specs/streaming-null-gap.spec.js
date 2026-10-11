/**
 * A rolling window with a null in it scrolls as one line (#5316).
 *
 * The null splits the series into segments, drawn as subpaths of one path
 * element (#3249). A rolling-window update under `xaxis.range` is a stream
 * scroll: every point slides left by one step. The scroll's start shape used
 * to be built from the first segment only, so the segment after the gap was
 * missing on frame 0 and then grew in from the left edge of the plot, on every
 * update, while the one before the gap slid as it should.
 *
 * Start: the line as it was on screen. End: every point one step left of
 * where it was. In between, every segment is drawn and only moves left. The
 * update matrix cannot state this: its noJump reads path geometry without the
 * grid clip, and a stream scroll's first frame carries an off-screen tail on
 * either end, so it flags every stream scroll, with a gap or without one.
 */

import { test, expect } from '@playwright/test'
import { mountChart, recordTransition, TOL } from '../helpers/frames.js'

const STEP = 1000
const N = 20
// Two points of runway off the left edge, as a feed trimmed by time keeps.
const RANGE = (N - 3) * STEP
const T0 = Date.UTC(2026, 0, 1)
const GAP = 12

/** The window after `s` ticks: N points, a null at point GAP. */
const windowAt = (s) =>
  Array.from({ length: N }, (_, k) => [
    T0 + (s + k) * STEP,
    s + k === GAP ? null : Math.round(50 + 30 * Math.sin((s + k) / 3)),
  ])

/** x of the first point of every subpath, per path of the series. */
const segmentStarts = (cls) =>
  [...document.querySelectorAll(`.apexcharts-series path.${cls}`)].map((p) =>
    (p.getAttribute('d') || '')
      .split('M')
      .slice(1)
      .map((s) => parseFloat(s)),
  )

for (const type of ['line', 'area']) {
  test(`${type}: every segment slides one step, the one after the gap included`, async ({
    page,
  }) => {
    const errors = await mountChart(page, {
      chart: {
        type,
        height: 320,
        toolbar: { show: false },
        zoom: { enabled: false },
        animations: { dynamicAnimation: { speed: 350 } },
      },
      dataLabels: { enabled: false },
      markers: { size: 0 },
      stroke: { curve: 'smooth' },
      xaxis: { type: 'datetime', range: RANGE },
      yaxis: { min: 0, max: 100 },
      series: [{ name: 'v', data: windowAt(0) }],
    })
    const step = await page.evaluate(
      ([s, r]) => (window.chart.w.layout.gridWidth * s) / r,
      [STEP, RANGE],
    )

    const rec = await recordTransition(
      page,
      () =>
        page.evaluate(
          (d) => window.chart.updateSeries([{ data: d }]),
          windowAt(1),
        ),
      { probe: segmentStarts, probeArg: `apexcharts-${type}` },
    )
    const before = rec.probeBefore
    const frames = rec.probes
    const last = frames[frames.length - 1]

    // the gap splits every path of the series
    for (const starts of before) expect(starts.length).toBeGreaterThan(1)

    // Before the update the first segment begins with the point the window
    // drops, after it with the next one, which lands where the dropped one
    // was. Every later segment begins with the same point on both sides and
    // lands one step left.
    before.forEach((starts, p) =>
      starts.forEach((x, k) => {
        const lands = k === 0 ? x : x - step
        expect(
          Math.abs(last[p][k] - lands),
          `end, path ${p}, segment ${k}`,
        ).toBeLessThanOrEqual(TOL)
      }),
    )

    // Every segment is drawn on every frame, starts one step right of where it
    // lands (for those after a gap, that is where they were on screen), and
    // only moves left on the way.
    frames.forEach((paths, f) => {
      expect(paths.length, `frame ${f}: path count`).toBe(before.length)
      paths.forEach((starts, p) => {
        expect(starts.length, `frame ${f}, path ${p}: segment count`).toBe(
          before[p].length,
        )
        starts.forEach((x, k) => {
          const at = `frame ${f}, path ${p}, segment ${k}`
          const lands = last[p][k]
          if (f === 0) {
            expect(Math.abs(x - (lands + step)), at).toBeLessThanOrEqual(TOL)
          } else {
            const was = frames[f - 1][p][k]
            expect(x, `${at}: moved right`).toBeLessThanOrEqual(was + TOL)
          }
          expect(x, at).toBeLessThanOrEqual(lands + step + TOL)
          expect(x, at).toBeGreaterThanOrEqual(lands - TOL)
        })
      })
    })
    expect(errors).toEqual([])
  })
}
