import type { Engine, SqlValue } from '../../vendor/perfetto/engine.js'
import { parseMetadata } from '../archive'
import type { CaptureFacts, CaptureSource, FactRow, FactSection, Scalar, WindowSelectionRequest } from '../types'
import { QUERIES, QUERY_LABELS } from './queries'
import { selectAnalysisWindow } from './windowSelection'

type RawRow = Record<string, Scalar>
type QueryOutcome = { rows: RawRow[]; error?: string }

const BUCKETS: Array<[number, number]> = [
  [0, 10_000],
  [10_000, 50_000],
  [50_000, 100_000],
  [100_000, 500_000],
  [500_000, 1_000_000],
  [1_000_000, 5_000_000],
  [5_000_000, 10_000_000],
  [10_000_000, 50_000_000],
  [50_000_000, 100_000_000],
]

function scalar(value: SqlValue): Scalar {
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Uint8Array) return Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return value
}

async function query(engine: Engine, sql: string): Promise<QueryOutcome> {
  const result = await engine.tryQuery(sql)
  if (!result.ok) return { rows: [], error: result.error }
  const queryError = result.value.error()
  if (queryError) return { rows: [], error: queryError }
  const columns = result.value.columns()
  const rows: RawRow[] = []
  for (const iterator = result.value.iter({}); iterator.valid(); iterator.next()) {
    rows.push(Object.fromEntries(columns.map((column) => [column, scalar(iterator.get(column))])))
  }
  return { rows }
}

function number(row: RawRow, key: string) {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(row: RawRow, key: string) {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function text(row: RawRow, key: string) {
  const value = row[key]
  return value == null ? '' : String(value)
}

export function stablePart(value: string | number) {
  return String(value).normalize('NFKC').trim().replace(/[\s.[\]#/]+/g, '_').replace(/_+/g, '_') || 'unknown'
}

export function stableHash(value: string) {
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, '0')
}

export function percentileFromBuckets(counts: number[], percentile: number, maximum?: number) {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total === 0) return undefined
  const target = Math.max(0, Math.min(1, percentile)) * total
  let cumulative = 0
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0
    if (count > 0 && cumulative + count >= target) {
      const [lower, defaultUpper] = BUCKETS[index] ?? BUCKETS.at(-1)!
      const upper = index === BUCKETS.length - 1 && maximum ? Math.max(lower, maximum) : defaultUpper
      const fraction = Math.max(0, Math.min(1, (target - cumulative) / count))
      return lower + (upper - lower) * fraction
    }
    cumulative += count
  }
  return maximum ?? BUCKETS.at(-1)![1]
}

function section(outcome: QueryOutcome, rows: FactRow[], emptyReason: string): FactSection {
  if (outcome.error) return { available: false, reason: outcome.error }
  if (rows.length === 0) return { available: false, reason: emptyReason }
  return { available: true, rows }
}

function metricRows(outcome: QueryOutcome, sourceQuery: string, keyColumn: string, labelColumn = keyColumn): FactRow[] {
  return outcome.rows.map((row) => ({
    key: stablePart(text(row, keyColumn)),
    label: text(row, labelColumn),
    values: Object.fromEntries(Object.entries(row).filter(([key]) => key !== keyColumn && key !== labelColumn)),
    sourceQuery,
  }))
}

function sliceRows(outcome: QueryOutcome, sourceQuery: string) {
  return outcome.rows.map((row): FactRow => {
    const counts = Array.from({ length: 9 }, (_, index) => number(row, `b${index}`))
    const maximum = number(row, 'maximum_duration_ns')
    return {
      key: stablePart(text(row, 'name')),
      label: text(row, 'name'),
      sourceQuery,
      values: {
        executionCount: number(row, 'execution_count'),
        incompleteCount: number(row, 'incomplete_count'),
        activeDurationNs: number(row, 'active_duration_ns'),
        averageDurationNs: number(row, 'average_duration_ns'),
        maximumDurationNs: maximum,
        averageIntervalNs: nullableNumber(row, 'average_interval_ns'),
        minimumIntervalNs: nullableNumber(row, 'minimum_interval_ns'),
        maximumIntervalNs: nullableNumber(row, 'maximum_interval_ns'),
        firstStartOffsetNs: number(row, 'first_start_offset_ns'),
        lastStartOffsetNs: number(row, 'last_start_offset_ns'),
        p50DurationNs: percentileFromBuckets(counts, 0.5, maximum) ?? null,
        p90DurationNs: percentileFromBuckets(counts, 0.9, maximum) ?? null,
        p95DurationNs: percentileFromBuckets(counts, 0.95, maximum) ?? null,
        p99DurationNs: percentileFromBuckets(counts, 0.99, maximum) ?? null,
      },
    }
  })
}

function perfFunctionRows(
  outcome: QueryOutcome,
  scope: 'all' | 'thread',
  packageName: string,
  sampleFrequencyHz?: number,
) {
  const packageParts = packageName.split('.').filter(Boolean)
  const packageRoot = packageParts.slice(0, Math.min(2, packageParts.length)).join('.')
  const packageRootNative = packageRoot.replaceAll('.', '_')
  return outcome.rows.flatMap((row): FactRow[] => {
    if (text(row, 'scope') !== scope) return []
    const functionName = text(row, 'frame_name')
    const applicationFunction = (number(row, 'app_mapping') === 1 && functionName.startsWith('[unknown @'))
      || Boolean(packageRoot && (functionName.includes(packageRoot) || functionName.includes(packageRootNative)))
    if (!applicationFunction) return []
    const threadName = text(row, 'thread_name')
    const inclusiveSampleCount = number(row, 'inclusive_sample_count')
    const selfSampleCount = number(row, 'self_sample_count')
    const estimates: Record<string, number> = sampleFrequencyHz
      ? {
          estimatedInclusiveOnCpuMs: inclusiveSampleCount / sampleFrequencyHz * 1000,
          estimatedSelfOnCpuMs: selfSampleCount / sampleFrequencyHz * 1000,
        }
      : {}
    const values = scope === 'thread'
      ? {
          inclusiveSampleCount,
          ...(sampleFrequencyHz ? { estimatedInclusiveOnCpuMs: inclusiveSampleCount / sampleFrequencyHz * 1000 } : {}),
        }
      : {
          inclusiveSampleCount,
          selfSampleCount,
          ...estimates,
        }
    return [{
      key: `function_${stableHash(`${scope}\u0000${threadName}\u0000${functionName}`)}`,
      label: scope === 'thread' ? `${threadName} · ${functionName}` : functionName,
      sourceQuery: QUERY_LABELS.perfFunctions,
      values,
    }]
  })
}

function chooseTarget(rows: RawRow[], packageHint?: string, pidHint?: number) {
  const byPid = pidHint ? rows.find((row) => number(row, 'pid') === pidHint) : undefined
  const exact = packageHint
    ? rows.find((row) => text(row, 'name') === packageHint || text(row, 'package_name') === packageHint)
    : undefined
  const prefixed = packageHint
    ? rows.find((row) => text(row, 'name').startsWith(`${packageHint}:`))
    : undefined
  const packaged = rows.find((row) => text(row, 'package_name'))
  return byPid ?? exact ?? prefixed ?? packaged ?? rows[0]
}

function metadataValue(rows: RawRow[], names: string[]) {
  const match = rows.find((row) => names.includes(text(row, 'name')))
  return match ? text(match, 'str_value') || number(match, 'int_value') || undefined : undefined
}

export type ExtractionProgress = (queryId: string, completed: number, total: number) => void

export async function extractCaptureFacts(
  engine: Engine,
  source: CaptureSource,
  windowRequest: WindowSelectionRequest,
  onProgress: ExtractionProgress = () => undefined,
): Promise<CaptureFacts> {
  const metadataFile = parseMetadata(source.metadataText)
  const packageHint = metadataFile.package
  const pidHint = metadataFile.pid ? Number(metadataFile.pid) : undefined
  const jobs = 20
  let completed = 0
  const run = async (id: string, sql: string) => {
    const outcome = await query(engine, sql)
    completed += 1
    onProgress(id, completed, jobs)
    return outcome
  }

  const boundsResult = await run('bounds', QUERIES.bounds)
  if (boundsResult.error || !boundsResult.rows[0]) {
    throw new Error(`trace_bounds 조회 실패: ${boundsResult.error ?? '결과 없음'}`)
  }
  const boundsRow = boundsResult.rows[0]
  const startNs = number(boundsRow, 'start_ts')
  const endNs = number(boundsRow, 'end_ts')

  const traceMetadata = await run('metadata', QUERIES.metadata)
  const processResult = await run('processes', QUERIES.processes)
  if (processResult.error) throw new Error(`대상 프로세스 조회 실패: ${processResult.error}`)
  const targetProcess = chooseTarget(processResult.rows, packageHint, pidHint)
  if (!targetProcess) throw new Error('trace에서 분석할 프로세스를 찾지 못했습니다.')
  const upid = number(targetProcess, 'upid')
  const packageName = packageHint || text(targetProcess, 'package_name') || text(targetProcess, 'name')
  const markerResult = await run('frameMarkers', QUERIES.frameMarkers(upid))
  const actualMarkers = markerResult.error
    ? []
    : markerResult.rows.filter((row) => text(row, 'source') === 'actual').map((row) => number(row, 'ts'))
  const expectedMarkers = markerResult.error
    ? []
    : markerResult.rows.filter((row) => text(row, 'source') === 'expected').map((row) => number(row, 'ts'))
  const frameMarkers = actualMarkers.length ? actualMarkers : expectedMarkers
  const windowSource = actualMarkers.length
    ? 'actual_frame_timeline'
    : expectedMarkers.length ? 'expected_frame_timeline' : 'trace_center'
  const window = selectAnalysisWindow(
    frameMarkers,
    { startNs, endNs },
    windowRequest,
    windowSource,
  )
  const range = { startNs: window.startNs, endNs: window.endNs }

  const qualityResult = await run('quality', QUERIES.quality)
  const threadsResult = await run('threads', QUERIES.threads(upid, range))
  const cpuResult = await run('cpuByCore', QUERIES.cpuByCore(upid, range))
  const stateResult = await run('threadStates', QUERIES.threadStates(upid, range))
  const frequencyResult = await run('cpuFrequency', QUERIES.cpuFrequency(range))
  const slicesResult = await run('slices', QUERIES.slices(upid, range))
  const framesResult = await run('frames', QUERIES.frames(upid, range))
  const expectedFramesResult = await run('expectedFrames', QUERIES.expectedFrames(upid, range))
  const memoryResult = await run('memory', QUERIES.memory(upid, range))
  const gcResult = await run('gc', QUERIES.slices(upid, range, "LOWER(s.name) LIKE '%gc%'"))
  const binderResult = await run('binder', QUERIES.slices(upid, range, "LOWER(s.name) LIKE 'binder transaction%'"))
  const perfSummaryResult = await run('perfSummary', QUERIES.perfSummary(upid, range))
  const perfThreadsResult = await run('perfThreads', QUERIES.perfThreads(upid, range))
  const perfSymbolsResult = await run('perfSymbols', QUERIES.perfSymbols(upid, range))
  const perfStacksResult = await run('perfStacks', QUERIES.perfStacks(upid, range))
  const perfFunctionsResult = await run('perfFunctions', QUERIES.perfFunctions(upid, range))

  const expectedFrameRows = expectedFramesResult.rows.flatMap((row): FactRow[] =>
    number(row, 'expected_frame_count') > 0
      ? [{
          key: 'expected',
          label: 'Expected frames',
          sourceQuery: QUERY_LABELS.expectedFrames,
          values: {
            frameCount: number(row, 'expected_frame_count'),
            averageDurationNs: number(row, 'average_duration_ns'),
            maximumDurationNs: number(row, 'maximum_duration_ns'),
          },
        }]
      : [],
  )
  const frameRows = framesResult.rows.map((row): FactRow => ({
    key: stablePart(text(row, 'jank_type')),
    label: text(row, 'jank_type'),
    sourceQuery: QUERY_LABELS.frames,
    values: {
      frameCount: number(row, 'frame_count'),
      totalDurationNs: number(row, 'total_duration_ns'),
      averageDurationNs: number(row, 'average_duration_ns'),
      maximumDurationNs: number(row, 'maximum_duration_ns'),
    },
  }))

  const perfSummary = perfSummaryResult.rows[0]
  const perfSampleCount = perfSummary ? number(perfSummary, 'sample_count') : 0
  const perfErrorCount = perfSummary ? number(perfSummary, 'unwind_error_count') : 0
  const sampleFrequencyHz = metadataFile.sample_frequency_hz ? Number(metadataFile.sample_frequency_hz) : undefined
  const qualityRows = qualityResult.rows.map((row) => ({
    name: text(row, 'name'),
    value: number(row, 'value'),
    severity: text(row, 'severity'),
  }))
  const selectedCpuTimeNs = threadsResult.rows.reduce((sum, row) => sum + number(row, 'cpu_time_ns'), 0)

  const sections: Record<string, FactSection> = {
    processes: section(processResult, [{
      key: stablePart(packageName),
      label: packageName,
      sourceQuery: QUERY_LABELS.processes,
      values: {
        pid: number(targetProcess, 'pid'),
        threadCount: threadsResult.rows.length,
        cpuTimeNs: selectedCpuTimeNs,
      },
    }], '대상 프로세스 없음'),
    threads: section(threadsResult, metricRows(threadsResult, QUERY_LABELS.threads, 'name'), '스레드 정보 없음'),
    cpuByCore: section(cpuResult, metricRows(cpuResult, QUERY_LABELS.cpuByCore, 'cpu'), '스케줄링 데이터 없음'),
    threadStates: section(stateResult, stateResult.rows.map((row) => ({
      key: `${stablePart(text(row, 'thread_name'))}__${stablePart(text(row, 'state'))}`,
      label: `${text(row, 'thread_name')} · ${text(row, 'state')}`,
      sourceQuery: QUERY_LABELS.threadStates,
      values: { durationNs: number(row, 'duration_ns'), occurrenceCount: number(row, 'occurrence_count') },
    })), '스레드 상태 데이터 없음'),
    cpuFrequency: section(frequencyResult, frequencyResult.rows.map((row) => ({
      key: `${stablePart(number(row, 'cpu'))}__${stablePart(text(row, 'name'))}`,
      label: `CPU ${number(row, 'cpu')} · ${text(row, 'name')}`,
      sourceQuery: QUERY_LABELS.cpuFrequency,
      values: {
        weightedAverage: number(row, 'weighted_average'), minimum: number(row, 'minimum'),
        maximum: number(row, 'maximum'), coveredNs: number(row, 'covered_ns'),
      },
    })), 'CPU 주파수 데이터 없음'),
    slices: section(slicesResult, sliceRows(slicesResult, QUERY_LABELS.slices), 'atrace slice 없음'),
    frames: section(
      framesResult.error ? framesResult : expectedFramesResult.error ? expectedFramesResult : framesResult,
      [...frameRows, ...expectedFrameRows],
      'FrameTimeline 데이터 없음',
    ),
    memory: section(memoryResult, metricRows(memoryResult, QUERY_LABELS.memory, 'name'), '프로세스 메모리 카운터 없음'),
    gc: section(gcResult, sliceRows(gcResult, QUERY_LABELS.gc), 'GC slice 없음'),
    binder: section(binderResult, sliceRows(binderResult, QUERY_LABELS.binder), 'Binder transaction slice 없음'),
    perfSummary: section(perfSummaryResult, perfSampleCount ? [{
      key: 'all',
      label: 'All perf samples',
      sourceQuery: QUERY_LABELS.perfSummary,
      values: { sampleCount: perfSampleCount, unwindErrorCount: perfErrorCount },
    }] : [], 'linux.perf 샘플 없음'),
    perfThreads: section(perfThreadsResult, perfThreadsResult.rows.map((row) => ({
      key: stablePart(text(row, 'thread_name')),
      label: text(row, 'thread_name'),
      sourceQuery: QUERY_LABELS.perfThreads,
      values: { sampleCount: number(row, 'sample_count'), unwindErrorCount: number(row, 'unwind_error_count') },
    })), 'linux.perf 샘플 없음'),
    perfSymbols: section(perfSymbolsResult, perfSymbolsResult.rows.map((row) => ({
      key: `${stablePart(text(row, 'symbol_name'))}__${stablePart(text(row, 'mapping_name'))}`,
      label: `${text(row, 'symbol_name')} · ${text(row, 'mapping_name')}`,
      sourceQuery: QUERY_LABELS.perfSymbols,
      values: { sampleCount: number(row, 'sample_count') },
    })), 'linux.perf 심볼 샘플 없음'),
    perfStacks: section(perfStacksResult, perfStacksResult.rows.map((row) => {
      const path = text(row, 'path')
      const sampleCount = number(row, 'sample_count')
      return {
        key: `stack_${stableHash(path)}`,
        label: path,
        sourceQuery: QUERY_LABELS.perfStacks,
        values: {
          sampleCount,
        },
      }
    }), 'linux.perf stack path 없음'),
    perfFunctions: section(
      perfFunctionsResult,
      perfFunctionRows(perfFunctionsResult, 'all', packageName, sampleFrequencyHz),
      'linux.perf 함수 표본 없음',
    ),
    perfFunctionsByThread: section(
      perfFunctionsResult,
      perfFunctionRows(perfFunctionsResult, 'thread', packageName, sampleFrequencyHz),
      'linux.perf thread별 함수 표본 없음',
    ),
  }

  const versionCode = number(targetProcess, 'version_code') || undefined
  const metadataBuild = metadataValue(traceMetadata.rows, ['android_build_fingerprint', 'build_fingerprint'])

  return {
    schemaVersion: 1,
    captureId: source.zipName.replace(/\.zip$/i, ''),
    source,
    traceBounds: { startNs, endNs, durationNs: endNs - startNs },
    bounds: { startNs: window.startNs, endNs: window.endNs, durationNs: window.durationNs },
    window,
    quality: {
      statsNonZero: qualityRows,
      unwindErrorRatio: perfSampleCount ? perfErrorCount / perfSampleCount : undefined,
    },
    target: {
      packageName,
      pid: number(targetProcess, 'pid'),
      upid,
      versionCode,
      androidBuild: metadataFile.device_build || (metadataBuild ? String(metadataBuild) : undefined),
      deviceModel: metadataFile.device_model,
      sampleFrequencyHz,
    },
    sections,
  }
}
