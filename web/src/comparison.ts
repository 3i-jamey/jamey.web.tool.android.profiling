import { DEFAULT_SECTION_LIMIT, FACT_PACK_MAX_BYTES } from './constants'
import type {
  CaptureFacts,
  CaptureSummary,
  ComparisonItem,
  ComparisonSection,
  FactPack,
  FactRow,
  NormalizedPair,
  Scalar,
} from './types'

function round(value: number | null, significantDigits = 8) {
  if (value === null || !Number.isFinite(value) || value === 0) return value
  return Number(value.toPrecision(significantDigits))
}

function pair(baseline: number | null, candidate: number | null): NormalizedPair {
  const deltaAbs = baseline === null || candidate === null ? null : candidate - baseline
  const deltaRatio = deltaAbs === null || baseline === null || baseline === 0 ? null : deltaAbs / Math.abs(baseline)
  return {
    baseline: round(baseline),
    candidate: round(candidate),
    deltaAbs: round(deltaAbs),
    deltaRatio: round(deltaRatio),
  }
}

function divide(value: number | null, denominator: number | null) {
  return value === null || denominator === null || denominator === 0 ? null : value / denominator
}

function numericValues(row?: FactRow) {
  return Object.fromEntries(
    Object.entries(row?.values ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number'),
  )
}

function buildItem(
  sectionName: string,
  rowKey: string,
  metric: string,
  baselineRow: FactRow | undefined,
  candidateRow: FactRow | undefined,
  denominators: FactPack['denominators'],
): ComparisonItem {
  const baselineValues = numericValues(baselineRow)
  const candidateValues = numericValues(candidateRow)
  let baseline = baselineValues[metric] ?? null
  let candidate = candidateValues[metric] ?? null
  const observedFunctionMetric = sectionName.startsWith('perfFunctions')
    && /(SampleCount|SampleRatio|OnCpuMs)$/i.test(metric)
  const observedOperationMetric = ['slices', 'gc', 'binder'].includes(sectionName) && metric === 'executionCount'
  if (observedFunctionMetric && baselineRow && !candidateRow) candidate = 0
  if (observedFunctionMetric && !baselineRow && candidateRow) baseline = 0
  if (observedOperationMetric && baselineRow && !candidateRow) candidate = 0
  if (observedOperationMetric && !baselineRow && candidateRow) baseline = 0
  const values = pair(baseline, candidate)
  const normalized: ComparisonItem['normalized'] = {}
  if (!/ratio$/i.test(metric) && !/^estimated/i.test(metric)) {
    normalized.perSecond = pair(
      divide(baseline, denominators.baseline.durationNs / 1e9),
      divide(candidate, denominators.candidate.durationNs / 1e9),
    )
    if (denominators.baseline.frameCount || denominators.candidate.frameCount) {
      normalized.perFrame = pair(
        divide(baseline, denominators.baseline.frameCount),
        divide(candidate, denominators.candidate.frameCount),
      )
    }
  }
  if (/durationns$/i.test(metric)) {
    const baselineCalls = baselineValues.executionCount ?? baselineValues.occurrenceCount ?? null
    const candidateCalls = candidateValues.executionCount ?? candidateValues.occurrenceCount ?? null
    normalized.perCall = pair(divide(baseline, baselineCalls), divide(candidate, candidateCalls))
  }
  return {
    key: `${sectionName}.${rowKey}.${metric}`,
    rowKey,
    label: baselineRow?.label ?? candidateRow?.label ?? rowKey,
    metric,
    ...values,
    normalized,
    sourceQuery: { baseline: baselineRow?.sourceQuery, candidate: candidateRow?.sourceQuery },
  }
}

function frameCount(facts: CaptureFacts) {
  const section = facts.sections.frames
  if (!section?.available) return null
  const count = section.rows
    .filter((row) => row.key !== 'expected')
    .reduce((sum, row) => sum + (typeof row.values.frameCount === 'number' ? row.values.frameCount : 0), 0)
  return count || null
}

function compareSection(
  sectionName: string,
  baselineFacts: CaptureFacts,
  candidateFacts: CaptureFacts,
  denominators: FactPack['denominators'],
): ComparisonSection {
  const baselineSection = baselineFacts.sections[sectionName]
  const candidateSection = candidateFacts.sections[sectionName]
  const baselineRows = new Map(baselineSection?.available ? baselineSection.rows.map((row) => [row.key, row]) : [])
  const candidateRows = new Map(candidateSection?.available ? candidateSection.rows.map((row) => [row.key, row]) : [])
  const commonKeys = [...baselineRows.keys()].filter((key) => candidateRows.has(key)).sort()
  const baselineOnlyKeys = [...baselineRows.keys()].filter((key) => !candidateRows.has(key)).sort()
  const candidateOnlyKeys = [...candidateRows.keys()].filter((key) => !baselineRows.has(key)).sort()

  const expand = (rowKey: string, baselineRow?: FactRow, candidateRow?: FactRow) => {
    const metrics = new Set([...Object.keys(numericValues(baselineRow)), ...Object.keys(numericValues(candidateRow))])
    return [...metrics].sort().map((metric) =>
      buildItem(sectionName, rowKey, metric, baselineRow, candidateRow, denominators),
    )
  }

  return {
    available: { baseline: Boolean(baselineSection?.available), candidate: Boolean(candidateSection?.available) },
    reason: {
      baseline: baselineSection && !baselineSection.available ? baselineSection.reason : undefined,
      candidate: candidateSection && !candidateSection.available ? candidateSection.reason : undefined,
    },
    items: commonKeys.flatMap((key) => expand(key, baselineRows.get(key), candidateRows.get(key))),
    onlyInBaseline: baselineOnlyKeys.flatMap((key) => expand(key, baselineRows.get(key), undefined)),
    onlyInCandidate: candidateOnlyKeys.flatMap((key) => expand(key, undefined, candidateRows.get(key))),
  }
}

function score(item: ComparisonItem) {
  return Math.max(Math.abs(item.baseline ?? 0), Math.abs(item.candidate ?? 0))
}

function limitSection(section: ComparisonSection, limit: number, sectionName: string): ComparisonSection {
  const all = [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate]
  const rowScores = new Map<string, number>()
  for (const item of all) {
    const operationSection = ['slices', 'gc', 'binder'].includes(sectionName)
    if (operationSection && item.metric !== 'executionCount') continue
    const itemScore = operationSection
      ? score(item) + Math.abs(item.deltaAbs ?? 0)
      : sectionName.startsWith('perfFunctions') && item.deltaAbs !== null
        ? Math.abs(item.deltaAbs)
        : score(item)
    rowScores.set(item.rowKey, Math.max(rowScores.get(item.rowKey) ?? 0, itemScore))
  }
  const rankedRows = [...rowScores]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const retainedRows = new Set(rankedRows.slice(0, limit).map(([rowKey]) => rowKey))
  const rowRanks = new Map(rankedRows.map(([rowKey], index) => [rowKey, index]))
  const omittedRows = new Set(rankedRows.slice(limit).map(([rowKey]) => rowKey))
  const omittedItems = all.filter((item) => omittedRows.has(item.rowKey))
  const retainAndRank = (items: ComparisonItem[]) => items
    .filter((item) => retainedRows.has(item.rowKey))
    .sort((a, b) => (rowRanks.get(a.rowKey) ?? 0) - (rowRanks.get(b.rowKey) ?? 0) || a.key.localeCompare(b.key))
  return {
    ...section,
    items: retainAndRank(section.items),
    onlyInBaseline: retainAndRank(section.onlyInBaseline),
    onlyInCandidate: retainAndRank(section.onlyInCandidate),
    omitted: omittedRows.size
      ? { count: omittedRows.size, sumOfOmitted: round(omittedItems.reduce((sum, item) => sum + score(item), 0)) ?? 0, limit }
      : undefined,
  }
}

function summary(facts: CaptureFacts): CaptureSummary {
  return {
    captureId: facts.captureId,
    source: { zipName: facts.source.zipName, traceEntry: facts.source.traceEntry },
    bounds: facts.bounds,
    traceBounds: facts.traceBounds,
    window: facts.window,
    quality: facts.quality,
    target: facts.target,
  }
}

function environment(key: string, baseline: Scalar | undefined, candidate: Scalar | undefined) {
  return { key, baseline, candidate, different: baseline !== candidate }
}

function buildAtLimit(baseline: CaptureFacts, candidate: CaptureFacts, limit: number): FactPack {
  const denominators = {
    baseline: { durationNs: baseline.bounds.durationNs, frameCount: frameCount(baseline) },
    candidate: { durationNs: candidate.bounds.durationNs, frameCount: frameCount(candidate) },
  }
  const sectionNames = [...new Set([...Object.keys(baseline.sections), ...Object.keys(candidate.sections)])].sort()
  const sections = Object.fromEntries(sectionNames.map((name) => [
    name,
    limitSection(compareSection(name, baseline, candidate, denominators), limit, name),
  ]))
  return {
    schemaVersion: 1,
    baseline: summary(baseline),
    candidate: summary(candidate),
    denominators,
    environment: [
      environment('durationNs', baseline.bounds.durationNs, candidate.bounds.durationNs),
      environment('traceDurationNs', baseline.traceBounds.durationNs, candidate.traceBounds.durationNs),
      environment('window.source', baseline.window.source, candidate.window.source),
      environment('window.markerCount', baseline.window.profile.markerCount, candidate.window.profile.markerCount),
      environment('window.medianIntervalNs', baseline.window.profile.medianIntervalNs, candidate.window.profile.medianIntervalNs),
      environment('window.p90IntervalNs', baseline.window.profile.p90IntervalNs, candidate.window.profile.p90IntervalNs),
      environment('packageName', baseline.target.packageName, candidate.target.packageName),
      environment('versionCode', baseline.target.versionCode, candidate.target.versionCode),
      environment('androidBuild', baseline.target.androidBuild, candidate.target.androidBuild),
      environment('deviceModel', baseline.target.deviceModel, candidate.target.deviceModel),
      environment('sampleFrequencyHz', baseline.target.sampleFrequencyHz, candidate.target.sampleFrequencyHz),
      ...sectionNames.map((name) => environment(
        `section.${name}.available`,
        baseline.sections[name]?.available ?? false,
        candidate.sections[name]?.available ?? false,
      )),
    ],
    sections,
    budget: {
      byteLength: 0,
      maxBytes: FACT_PACK_MAX_BYTES,
      initialLimit: DEFAULT_SECTION_LIMIT,
      finalLimit: limit,
      reduced: limit < DEFAULT_SECTION_LIMIT,
    },
  }
}

export function serializeFactPack(pack: FactPack) {
  return JSON.stringify(pack)
}

function measure(pack: FactPack) {
  let previous = -1
  let current = 0
  while (current !== previous) {
    previous = current
    pack.budget.byteLength = current
    current = new TextEncoder().encode(serializeFactPack(pack)).byteLength
  }
  pack.budget.byteLength = current
  return current
}

export function compareCaptures(baseline: CaptureFacts, candidate: CaptureFacts): FactPack {
  let limit = DEFAULT_SECTION_LIMIT
  let pack = buildAtLimit(baseline, candidate, limit)
  let byteLength = measure(pack)
  while (byteLength > FACT_PACK_MAX_BYTES && limit > 5) {
    limit = Math.max(5, limit - 5)
    pack = buildAtLimit(baseline, candidate, limit)
    byteLength = measure(pack)
  }
  return pack
}

export function citationIndex(pack: FactPack) {
  return new Map(
    Object.values(pack.sections).flatMap((section) =>
      [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate].map((item) => [item.key, item] as const),
    ),
  )
}
