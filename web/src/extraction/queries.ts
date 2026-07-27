type TimeRange = { startNs: number; endNs: number }

const eventIn = (alias: string, range: TimeRange) => `${alias}.ts >= ${range.startNs} AND ${alias}.ts < ${range.endNs}`
const overlaps = (alias: string, range: TimeRange) => `${alias}.dur >= 0 AND ${alias}.ts < ${range.endNs} AND ${alias}.ts + ${alias}.dur > ${range.startNs}`
const clippedDuration = (alias: string, range: TimeRange) => `MIN(${alias}.ts + ${alias}.dur, ${range.endNs}) - MAX(${alias}.ts, ${range.startNs})`

export const QUERIES = {
  bounds: `SELECT start_ts, end_ts FROM trace_bounds`,
  metadata: `SELECT name, int_value, str_value FROM metadata ORDER BY name`,
  quality: `SELECT name, idx, value, severity FROM stats WHERE value != 0 ORDER BY severity DESC, name, idx`,
  processes: `
    SELECT p.upid, p.pid, COALESCE(p.name, p.cmdline, 'process-' || p.pid) AS name,
      p.cmdline, pl.package_name, pl.version_code,
      COALESCE(SUM(CASE WHEN ss.dur >= 0 THEN ss.dur ELSE 0 END), 0) AS cpu_time_ns,
      COUNT(DISTINCT t.utid) AS thread_count
    FROM process p
    LEFT JOIN package_list pl ON pl.package_name = p.name
    LEFT JOIN thread t ON t.upid = p.upid
    LEFT JOIN sched_slice ss ON ss.utid = t.utid
    GROUP BY p.upid
    ORDER BY cpu_time_ns DESC, p.upid`,
  frameMarkers: (upid: number) => `
    SELECT ts, 'actual' AS source FROM actual_frame_timeline_slice WHERE upid = ${upid}
    UNION ALL
    SELECT ts, 'expected' AS source FROM expected_frame_timeline_slice WHERE upid = ${upid}
    ORDER BY ts`,
  threads: (upid: number, range: TimeRange) => `
    SELECT COALESCE(t.name, 'thread-' || t.tid) AS name, MIN(t.tid) AS tid,
      SUM(COALESCE(${clippedDuration('ss', range)}, 0)) AS cpu_time_ns,
      COUNT(ss.id) AS run_count
    FROM thread t LEFT JOIN sched_slice ss ON ss.utid = t.utid AND ${overlaps('ss', range)}
    WHERE t.upid = ${upid}
    GROUP BY name ORDER BY cpu_time_ns DESC, name`,
  cpuByCore: (upid: number, range: TimeRange) => `
    SELECT ss.cpu, SUM(${clippedDuration('ss', range)}) AS cpu_time_ns, COUNT(*) AS run_count
    FROM sched_slice ss JOIN thread t ON t.utid = ss.utid
    WHERE t.upid = ${upid} AND ${overlaps('ss', range)}
    GROUP BY ss.cpu ORDER BY ss.cpu`,
  threadStates: (upid: number, range: TimeRange) => `
    SELECT COALESCE(t.name, 'thread-' || t.tid) AS thread_name, ts.state,
      SUM(${clippedDuration('ts', range)}) AS duration_ns, COUNT(*) AS occurrence_count
    FROM thread_state ts JOIN thread t ON t.utid = ts.utid
    WHERE t.upid = ${upid} AND ${overlaps('ts', range)}
    GROUP BY thread_name, ts.state ORDER BY duration_ns DESC, thread_name`,
  cpuFrequency: (range: TimeRange) => `
    WITH samples AS (
      SELECT ct.cpu, ct.name, c.ts, c.value,
        LEAD(c.ts, 1, (SELECT end_ts FROM trace_bounds)) OVER (PARTITION BY c.track_id ORDER BY c.ts) - c.ts AS dur
      FROM counter c JOIN cpu_counter_track ct ON ct.id = c.track_id
      WHERE LOWER(ct.name) LIKE '%freq%'
    ), windowed AS (
      SELECT cpu, name, value,
        MIN(ts + dur, ${range.endNs}) - MAX(ts, ${range.startNs}) AS dur
      FROM samples
      WHERE dur >= 0 AND ts < ${range.endNs} AND ts + dur > ${range.startNs}
    )
    SELECT cpu, name,
      SUM(value * dur) / NULLIF(SUM(dur), 0) AS weighted_average,
      MIN(value) AS minimum, MAX(value) AS maximum, SUM(dur) AS covered_ns
    FROM windowed GROUP BY cpu, name ORDER BY cpu, name`,
  slices: (upid: number, range: TimeRange, predicate = '1 = 1') => `
    WITH target_tracks AS (
      SELECT tt.id FROM thread_track tt JOIN thread t ON t.utid = tt.utid WHERE t.upid = ${upid}
      UNION SELECT pt.id FROM process_track pt WHERE pt.upid = ${upid}
    ), started_base AS (
      SELECT s.name, s.ts, s.dur AS original_dur,
        CASE WHEN s.dur >= 0 THEN MIN(s.dur, ${range.endNs} - s.ts) ELSE 0 END AS dur
      FROM slice s JOIN target_tracks target ON target.id = s.track_id
      WHERE ${eventIn('s', range)} AND (${predicate})
    ), started AS (
      SELECT name, ts, original_dur, dur,
        ts - LAG(ts) OVER (PARTITION BY name ORDER BY ts) AS interval_ns
      FROM started_base
    )
    SELECT name, COUNT(*) AS execution_count,
      SUM(CASE WHEN original_dur < 0 THEN 1 ELSE 0 END) AS incomplete_count,
      SUM(dur) AS active_duration_ns,
      AVG(CASE WHEN original_dur >= 0 THEN dur END) AS average_duration_ns,
      MAX(CASE WHEN original_dur >= 0 THEN dur END) AS maximum_duration_ns,
      AVG(interval_ns) AS average_interval_ns,
      MIN(interval_ns) AS minimum_interval_ns,
      MAX(interval_ns) AS maximum_interval_ns,
      MIN(ts) - ${range.startNs} AS first_start_offset_ns,
      MAX(ts) - ${range.startNs} AS last_start_offset_ns,
      SUM(CASE WHEN original_dur >= 0 AND dur < 10000 THEN 1 ELSE 0 END) AS b0,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 10000 AND dur < 50000 THEN 1 ELSE 0 END) AS b1,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 50000 AND dur < 100000 THEN 1 ELSE 0 END) AS b2,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 100000 AND dur < 500000 THEN 1 ELSE 0 END) AS b3,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 500000 AND dur < 1000000 THEN 1 ELSE 0 END) AS b4,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 1000000 AND dur < 5000000 THEN 1 ELSE 0 END) AS b5,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 5000000 AND dur < 10000000 THEN 1 ELSE 0 END) AS b6,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 10000000 AND dur < 50000000 THEN 1 ELSE 0 END) AS b7,
      SUM(CASE WHEN original_dur >= 0 AND dur >= 50000000 THEN 1 ELSE 0 END) AS b8
    FROM started GROUP BY name ORDER BY execution_count DESC, name`,
  frames: (upid: number, range: TimeRange) => `
    SELECT COALESCE(NULLIF(jank_type, ''), 'None') AS jank_type, COUNT(*) AS frame_count,
      SUM(dur) AS total_duration_ns, AVG(dur) AS average_duration_ns, MAX(dur) AS maximum_duration_ns
    FROM actual_frame_timeline_slice
    WHERE upid = ${upid} AND dur >= 0 AND ${eventIn('actual_frame_timeline_slice', range)}
    GROUP BY jank_type ORDER BY frame_count DESC, jank_type`,
  expectedFrames: (upid: number, range: TimeRange) => `
    SELECT COUNT(*) AS expected_frame_count, AVG(dur) AS average_duration_ns, MAX(dur) AS maximum_duration_ns
    FROM expected_frame_timeline_slice WHERE upid = ${upid} AND dur >= 0 AND ${eventIn('expected_frame_timeline_slice', range)}`,
  memory: (upid: number, range: TimeRange) => `
    WITH samples AS (
      SELECT pct.name, c.ts, c.value,
        ROW_NUMBER() OVER (PARTITION BY c.track_id ORDER BY c.ts) AS first_rank,
        ROW_NUMBER() OVER (PARTITION BY c.track_id ORDER BY c.ts DESC) AS last_rank
      FROM counter c JOIN process_counter_track pct ON pct.id = c.track_id
      WHERE pct.upid = ${upid} AND (LOWER(pct.name) LIKE 'mem.%' OR LOWER(pct.name) LIKE '%gpu%')
        AND ${eventIn('c', range)}
    )
    SELECT name, MAX(CASE WHEN first_rank = 1 THEN value END) AS start_value,
      MAX(CASE WHEN last_rank = 1 THEN value END) AS end_value,
      AVG(value) AS average_value, MAX(value) AS maximum_value, COUNT(*) AS sample_count
    FROM samples GROUP BY name ORDER BY maximum_value DESC, name`,
  perfSummary: (upid: number, range: TimeRange) => `
    SELECT COUNT(*) AS sample_count,
      SUM(CASE WHEN ps.unwind_error IS NOT NULL AND ps.unwind_error != '' THEN 1 ELSE 0 END) AS unwind_error_count
    FROM perf_sample ps JOIN thread t ON t.utid = ps.utid
    WHERE t.upid = ${upid} AND ${eventIn('ps', range)}`,
  perfThreads: (upid: number, range: TimeRange) => `
    SELECT COALESCE(t.name, 'thread-' || t.tid) AS thread_name, COUNT(*) AS sample_count,
      SUM(CASE WHEN ps.unwind_error IS NOT NULL AND ps.unwind_error != '' THEN 1 ELSE 0 END) AS unwind_error_count
    FROM perf_sample ps JOIN thread t ON t.utid = ps.utid
    WHERE t.upid = ${upid} AND ${eventIn('ps', range)}
    GROUP BY thread_name ORDER BY sample_count DESC, thread_name`,
  perfSymbols: (upid: number, range: TimeRange) => `
    SELECT COALESCE(NULLIF(spf.deobfuscated_name, ''), NULLIF(spf.name, ''), '[unknown]') AS symbol_name,
      COALESCE(spm.name, '[unknown mapping]') AS mapping_name, COUNT(*) AS sample_count
    FROM perf_sample ps
    JOIN thread t ON t.utid = ps.utid
    JOIN stack_profile_callsite spc ON spc.id = ps.callsite_id
    JOIN stack_profile_frame spf ON spf.id = spc.frame_id
    LEFT JOIN stack_profile_mapping spm ON spm.id = spf.mapping
    WHERE t.upid = ${upid} AND ${eventIn('ps', range)}
    GROUP BY symbol_name, mapping_name ORDER BY sample_count DESC, symbol_name`,
  perfStacks: (upid: number, range: TimeRange) => `
    WITH RECURSIVE
    callsite_frames AS (
      SELECT spc.id, spc.parent_id,
        CASE
          WHEN COALESCE(NULLIF(spf.deobfuscated_name, ''), NULLIF(spf.name, '')) IS NOT NULL
            THEN COALESCE(NULLIF(spf.deobfuscated_name, ''), NULLIF(spf.name, ''))
          ELSE '[unknown @ ' || COALESCE(spm.name, 'unknown mapping') || ']'
        END AS frame_name
      FROM stack_profile_callsite spc
      JOIN stack_profile_frame spf ON spf.id = spc.frame_id
      LEFT JOIN stack_profile_mapping spm ON spm.id = spf.mapping
    ),
    sample_stacks(sample_id, callsite_id, parent_id, depth, path) AS (
      SELECT ps.id, frame.id, frame.parent_id, 1, frame.frame_name
      FROM perf_sample ps
      JOIN thread t ON t.utid = ps.utid
      JOIN callsite_frames frame ON frame.id = ps.callsite_id
      WHERE t.upid = ${upid} AND ${eventIn('ps', range)}
      UNION ALL
      SELECT stack.sample_id, parent.id, parent.parent_id, stack.depth + 1,
        parent.frame_name || ' > ' || stack.path
      FROM sample_stacks stack
      JOIN callsite_frames parent ON parent.id = stack.parent_id
      WHERE stack.depth < 256
    ),
    complete_stacks AS (
      SELECT path, depth
      FROM sample_stacks stack
      WHERE stack.depth = 256
        OR stack.parent_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM callsite_frames parent WHERE parent.id = stack.parent_id)
    )
    SELECT CASE WHEN depth = 256 THEN '[truncated] > ' || path ELSE path END AS path,
      MAX(depth) AS frame_count, COUNT(*) AS sample_count
    FROM complete_stacks
    GROUP BY path
    ORDER BY sample_count DESC, path`,
  perfFunctions: (upid: number, range: TimeRange) => `
    WITH RECURSIVE
    callsite_frames AS (
      SELECT spc.id, spc.parent_id,
        CASE
          WHEN COALESCE(NULLIF(spf.deobfuscated_name, ''), NULLIF(spf.name, '')) IS NOT NULL
            THEN COALESCE(NULLIF(spf.deobfuscated_name, ''), NULLIF(spf.name, ''))
          ELSE '[unknown @ ' || COALESCE(spm.name, 'unknown mapping') || ']'
        END AS frame_name,
        CASE WHEN spm.name LIKE '%/data/app/%' OR spm.name LIKE '%base.apk%' THEN 1 ELSE 0 END AS app_mapping
      FROM stack_profile_callsite spc
      JOIN stack_profile_frame spf ON spf.id = spc.frame_id
      LEFT JOIN stack_profile_mapping spm ON spm.id = spf.mapping
    ),
    target_samples AS (
      SELECT ps.id AS sample_id, COALESCE(t.name, 'thread-' || t.tid) AS thread_name,
        frame.id AS callsite_id, frame.parent_id, frame.frame_name, frame.app_mapping
      FROM perf_sample ps
      JOIN thread t ON t.utid = ps.utid
      JOIN callsite_frames frame ON frame.id = ps.callsite_id
      WHERE t.upid = ${upid} AND ${eventIn('ps', range)}
    ),
    sample_frames(sample_id, thread_name, callsite_id, parent_id, depth, frame_name, app_mapping) AS (
      SELECT sample_id, thread_name, callsite_id, parent_id, 1, frame_name, app_mapping FROM target_samples
      UNION ALL
      SELECT stack.sample_id, stack.thread_name, parent.id, parent.parent_id,
        stack.depth + 1, parent.frame_name, parent.app_mapping
      FROM sample_frames stack
      JOIN callsite_frames parent ON parent.id = stack.parent_id
      WHERE stack.depth < 256
    ),
    inclusive_counts AS (
      SELECT 'all' AS scope, '' AS thread_name, frame_name,
        COUNT(DISTINCT sample_id) AS inclusive_sample_count, MAX(app_mapping) AS app_mapping
      FROM sample_frames GROUP BY frame_name
      UNION ALL
      SELECT 'thread' AS scope, thread_name, frame_name,
        COUNT(DISTINCT sample_id) AS inclusive_sample_count, MAX(app_mapping) AS app_mapping
      FROM sample_frames GROUP BY thread_name, frame_name
    ),
    self_counts AS (
      SELECT 'all' AS scope, '' AS thread_name, frame_name, COUNT(*) AS self_sample_count
      FROM target_samples GROUP BY frame_name
      UNION ALL
      SELECT 'thread' AS scope, thread_name, frame_name, COUNT(*) AS self_sample_count
      FROM target_samples GROUP BY thread_name, frame_name
    )
    SELECT inclusive.scope, inclusive.thread_name, inclusive.frame_name,
      inclusive.inclusive_sample_count, COALESCE(self.self_sample_count, 0) AS self_sample_count,
      inclusive.app_mapping
    FROM inclusive_counts inclusive
    LEFT JOIN self_counts self
      ON self.scope = inclusive.scope
      AND self.thread_name = inclusive.thread_name
      AND self.frame_name = inclusive.frame_name
    ORDER BY inclusive.scope, inclusive.inclusive_sample_count DESC, inclusive.frame_name`,
} as const

export const QUERY_LABELS: Record<string, string> = {
  bounds: 'trace_bounds',
  metadata: 'metadata',
  quality: 'stats_non_zero',
  processes: 'process_cpu',
  frameMarkers: 'frame_timeline_marker',
  threads: 'thread_cpu',
  cpuByCore: 'cpu_distribution',
  threadStates: 'thread_state',
  cpuFrequency: 'cpu_frequency',
  slices: 'atrace_operation_window',
  frames: 'actual_frame_timeline',
  expectedFrames: 'expected_frame_timeline',
  memory: 'process_memory_counter',
  gc: 'dalvik_gc_operation_window',
  binder: 'binder_operation_window',
  perfSummary: 'perf_sample_summary',
  perfThreads: 'perf_sample_thread',
  perfSymbols: 'perf_sample_symbol',
  perfStacks: 'perf_sample_stack_path',
  perfFunctions: 'perf_sample_function_inclusive',
}
