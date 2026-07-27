import { describe, expect, it } from 'vitest'
import { selectAnalysisWindow } from './windowSelection'

describe('selectAnalysisWindow', () => {
  const bounds = { startNs: 0, endNs: 3_000_000_000 }

  it('selects a representative baseline cadence without using performance values', () => {
    const markers = [100, 100_000_100, 200_000_100, 300_000_100, 400_000_100, 900_000_000]
    const window = selectAnalysisWindow(markers, bounds, { durationNs: 1_000_000_000 })
    expect(window).toMatchObject({ durationNs: 1_000_000_000, selection: 'representative' })
    expect(window.profile.markerCount).toBeGreaterThan(0)
  })

  it('matches candidate loop count and intervals to the baseline profile', () => {
    const markers = Array.from({ length: 10 }, (_, index) => index * 100_000_000 + 10)
    const window = selectAnalysisWindow(markers, bounds, {
      durationNs: 1_000_000_000,
      reference: { markerCount: 10, medianIntervalNs: 100_000_000, p90IntervalNs: 100_000_000 },
    })
    expect(window.startNs).toBe(10)
    expect(window.similarityScore).toBe(0)
  })

  it('falls back to the centered window without FrameTimeline data', () => {
    const window = selectAnalysisWindow([], bounds, { durationNs: 1_000_000_000 })
    expect(window).toMatchObject({ source: 'trace_center', startNs: 1_000_000_000, durationNs: 1_000_000_000 })
  })
})
