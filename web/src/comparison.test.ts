import { describe, expect, it } from 'vitest'
import { citationIndex, compareCaptures, serializeFactPack } from './comparison'
import type { CaptureFacts, FactSection } from './types'

function facts(id: string, durationNs: number, section: FactSection): CaptureFacts {
  return {
    schemaVersion: 1,
    captureId: id,
    source: { zipName: `${id}.zip`, traceEntry: `${id}.perfetto-trace` },
    traceBounds: { startNs: 0, endNs: 10e9, durationNs: 10e9 },
    bounds: { startNs: 10, endNs: 10 + durationNs, durationNs },
    window: {
      source: 'actual_frame_timeline', startNs: 10, endNs: 10 + durationNs, durationNs,
      startOffsetNs: 10, selection: id === 'a' ? 'representative' : 'matched', similarityScore: 0,
      profile: { markerCount: 5, medianIntervalNs: 100e6, p90IntervalNs: 100e6 },
    },
    quality: { statsNonZero: [] },
    target: { packageName: 'app.test', pid: id === 'a' ? 1 : 2 },
    sections: { slices: section },
  }
}

describe('compareCaptures', () => {
  it('pairs rows, computes deltas, and retains one-sided rows', () => {
    const baseline = facts('a', 1e9, { available: true, rows: [
      { key: 'common', label: 'Common', sourceQuery: 'q', values: { totalDurationNs: 100, executionCount: 2, sampleRatio: 0.5 } },
      { key: 'removed', label: 'Removed', sourceQuery: 'q', values: { executionCount: 3, totalDurationNs: 30 } },
    ] })
    const candidate = facts('b', 2e9, { available: true, rows: [
      { key: 'common', label: 'Common', sourceQuery: 'q', values: { totalDurationNs: 150, executionCount: 3, sampleRatio: 0.25 } },
      { key: 'added', label: 'Added', sourceQuery: 'q', values: { executionCount: 9, totalDurationNs: 90 } },
    ] })

    const pack = compareCaptures(baseline, candidate)
    const item = citationIndex(pack).get('slices.common.totalDurationNs')
    expect(item).toMatchObject({ baseline: 100, candidate: 150, deltaAbs: 50, deltaRatio: 0.5 })
    expect(item?.normalized.perSecond).toMatchObject({ baseline: 100, candidate: 75, deltaAbs: -25 })
    expect(citationIndex(pack).get('slices.common.sampleRatio')?.normalized).toEqual({})
    expect(pack.sections.slices.onlyInBaseline.map((value) => value.rowKey)).toContain('removed')
    expect(pack.sections.slices.onlyInCandidate.map((value) => value.rowKey)).toContain('added')
    expect(pack.budget.byteLength).toBe(new TextEncoder().encode(serializeFactPack(pack)).byteLength)
  })

  it('is deterministic and reports unavailable sections', () => {
    const baseline = facts('a', 1e9, { available: false, reason: 'missing' })
    const candidate = facts('b', 1e9, { available: false, reason: 'missing' })
    expect(serializeFactPack(compareCaptures(baseline, candidate)))
      .toBe(serializeFactPack(compareCaptures(baseline, candidate)))
    expect(compareCaptures(baseline, candidate).sections.slices.available).toEqual({ baseline: false, candidate: false })
  })

  it('treats an unobserved function as zero without normalizing estimated CPU time', () => {
    const baseline = facts('a', 1e9, { available: false, reason: 'unused' })
    const candidate = facts('b', 1e9, { available: false, reason: 'unused' })
    baseline.sections = { perfFunctions: { available: true, rows: [{
      key: 'function_1',
      label: 'nativePreprocessNv21',
      sourceQuery: 'perf_sample_function_inclusive',
      values: { inclusiveSampleCount: 317, estimatedInclusiveOnCpuMs: 3170 },
    }] } }
    candidate.sections = { perfFunctions: { available: true, rows: [] } }

    const index = citationIndex(compareCaptures(baseline, candidate))
    expect(index.get('perfFunctions.function_1.inclusiveSampleCount')).toMatchObject({
      baseline: 317,
      candidate: 0,
      deltaAbs: -317,
      deltaRatio: -1,
    })
    expect(index.get('perfFunctions.function_1.estimatedInclusiveOnCpuMs')).toMatchObject({
      baseline: 3170,
      candidate: 0,
      deltaAbs: -3170,
      normalized: {},
    })
  })

  it('ranks operations by execution count instead of duration magnitude', () => {
    const baseline = facts('a', 1e9, { available: true, rows: [
      { key: 'slow', label: 'Slow once', sourceQuery: 'q', values: { executionCount: 1, activeDurationNs: 900e6 } },
      { key: 'frequent', label: 'Frequent', sourceQuery: 'q', values: { executionCount: 20, activeDurationNs: 20e6 } },
    ] })
    const candidate = facts('b', 1e9, { available: true, rows: [
      { key: 'slow', label: 'Slow once', sourceQuery: 'q', values: { executionCount: 1, activeDurationNs: 800e6 } },
      { key: 'frequent', label: 'Frequent', sourceQuery: 'q', values: { executionCount: 18, activeDurationNs: 18e6 } },
    ] })

    const section = compareCaptures(baseline, candidate).sections.slices
    expect(section.items[0].rowKey).toBe('frequent')
  })
})
