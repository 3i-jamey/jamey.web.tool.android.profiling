import type { AnalysisWindow, WindowProfile, WindowSelectionRequest } from '../types'

function percentile(values: number[], ratio: number) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * ratio
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function profileAt(markers: number[], startNs: number, endNs: number): WindowProfile {
  const selected = markers.filter((timestamp) => timestamp >= startNs && timestamp < endNs)
  const intervals = selected.slice(1).map((timestamp, index) => timestamp - selected[index])
  return {
    markerCount: selected.length,
    medianIntervalNs: percentile(intervals, 0.5),
    p90IntervalNs: percentile(intervals, 0.9),
  }
}

function distance(left: WindowProfile, right: WindowProfile) {
  const ratio = (a: number | null, b: number | null) => {
    if (a === null || b === null) return a === b ? 0 : 1
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1)
  }
  return ratio(left.markerCount, right.markerCount)
    + ratio(left.medianIntervalNs, right.medianIntervalNs)
    + ratio(left.p90IntervalNs, right.p90IntervalNs)
}

export function selectAnalysisWindow(
  markerTimestamps: number[],
  traceBounds: { startNs: number; endNs: number },
  request: WindowSelectionRequest,
  source: AnalysisWindow['source'] = 'actual_frame_timeline',
): AnalysisWindow {
  const markers = [...markerTimestamps].sort((a, b) => a - b)
  const starts = markers.filter((timestamp) =>
    timestamp >= traceBounds.startNs && timestamp + request.durationNs <= traceBounds.endNs,
  )
  if (!starts.length) {
    if (traceBounds.endNs - traceBounds.startNs < request.durationNs) {
      throw new Error(`trace가 ${request.durationNs / 1e6}ms 분석 구간보다 짧습니다.`)
    }
    const startNs = Math.floor((traceBounds.startNs + traceBounds.endNs - request.durationNs) / 2)
    const profile = { markerCount: 0, medianIntervalNs: null, p90IntervalNs: null }
    return {
      source: 'trace_center',
      startNs,
      endNs: startNs + request.durationNs,
      durationNs: request.durationNs,
      startOffsetNs: startNs - traceBounds.startNs,
      selection: request.reference ? 'matched' : 'representative',
      similarityScore: request.reference ? distance(profile, request.reference) : 0,
      profile,
    }
  }
  const candidates = starts.map((startNs) => ({
    startNs,
    profile: profileAt(markers, startNs, startNs + request.durationNs),
  }))
  const target = request.reference ?? {
    markerCount: percentile(candidates.map((candidate) => candidate.profile.markerCount), 0.5) ?? 0,
    medianIntervalNs: percentile(candidates.flatMap((candidate) =>
      candidate.profile.medianIntervalNs === null ? [] : [candidate.profile.medianIntervalNs]), 0.5),
    p90IntervalNs: percentile(candidates.flatMap((candidate) =>
      candidate.profile.p90IntervalNs === null ? [] : [candidate.profile.p90IntervalNs]), 0.5),
  }
  const selected = candidates
    .map((candidate) => ({ ...candidate, score: distance(candidate.profile, target) }))
    .sort((a, b) => a.score - b.score || a.startNs - b.startNs)[0]
  return {
    source,
    startNs: selected.startNs,
    endNs: selected.startNs + request.durationNs,
    durationNs: request.durationNs,
    startOffsetNs: selected.startNs - traceBounds.startNs,
    selection: request.reference ? 'matched' : 'representative',
    similarityScore: selected.score,
    profile: selected.profile,
  }
}
