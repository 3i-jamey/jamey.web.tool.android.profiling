#!/usr/bin/env bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGE="app.pivo.android.capture.dev"
DURATION_SECONDS=30
SAMPLE_FREQUENCY=100
OUTPUT_ROOT="$REPO_ROOT/captures"

usage() {
    printf '%s\n' \
        "사용법: $0 [옵션]" \
        "" \
        "Perfetto 시스템 trace와 CPU callstack profile을 한 파일에 기록합니다." \
        "대상 앱은 미리 설치하고 실행해야 합니다." \
        "" \
        "옵션:" \
        "  -p, --package PACKAGE     대상 프로세스 (기본값: $PACKAGE)" \
        "  -d, --duration SECONDS   기록 시간, 1-300초 (기본값: $DURATION_SECONDS)" \
        "  -f, --frequency HZ       Callstack sampling 주파수, 1-200Hz (기본값: $SAMPLE_FREQUENCY)" \
        "  -o, --output DIRECTORY   출력 루트 (기본값: $OUTPUT_ROOT)" \
        "  -h, --help               도움말 출력"
}

fail() {
    printf '오류: %s\n' "$1" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -p|--package)
            [[ $# -ge 2 ]] || fail "$1 값이 없습니다"
            PACKAGE="$2"
            shift 2
            ;;
        -d|--duration)
            [[ $# -ge 2 ]] || fail "$1 값이 없습니다"
            DURATION_SECONDS="$2"
            shift 2
            ;;
        -f|--frequency)
            [[ $# -ge 2 ]] || fail "$1 값이 없습니다"
            SAMPLE_FREQUENCY="$2"
            shift 2
            ;;
        -o|--output)
            [[ $# -ge 2 ]] || fail "$1 값이 없습니다"
            OUTPUT_ROOT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "알 수 없는 옵션: $1"
            ;;
    esac
done

[[ "$PACKAGE" =~ ^[A-Za-z0-9._:]+$ ]] || fail "잘못된 package 이름: $PACKAGE"
[[ "$DURATION_SECONDS" =~ ^[0-9]+$ ]] || fail "기록 시간은 정수여야 합니다"
[[ "$SAMPLE_FREQUENCY" =~ ^[0-9]+$ ]] || fail "Sampling 주파수는 정수여야 합니다"
(( DURATION_SECONDS >= 1 && DURATION_SECONDS <= 300 )) || fail "기록 시간은 1-300초여야 합니다"
(( SAMPLE_FREQUENCY >= 1 && SAMPLE_FREQUENCY <= 200 )) || fail "Sampling 주파수는 1-200Hz여야 합니다"

command -v adb >/dev/null 2>&1 || fail "PATH에서 adb를 찾지 못했습니다"

ADB=(adb)
if [[ -n "${ANDROID_SERIAL:-}" ]]; then
    ADB+=( -s "$ANDROID_SERIAL" )
fi

[[ "$("${ADB[@]}" get-state 2>/dev/null)" == "device" ]] || fail "연결되고 승인된 Android 기기가 없습니다"

APP_PID="$("${ADB[@]}" shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r')"
[[ -n "$APP_PID" ]] || fail "$PACKAGE 프로세스가 없습니다. 먼저 RUN PROFILE apk를 실행하세요."

readonly TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
readonly OUTPUT_DIR="$OUTPUT_ROOT/$TIMESTAMP"
readonly CONFIG_FILE="$OUTPUT_DIR/config.textproto"
readonly TRACE_FILE="$OUTPUT_DIR/trace-$TIMESTAMP.perfetto-trace"
readonly METADATA_FILE="$OUTPUT_DIR/metadata.txt"
readonly REMOTE_TRACE="/data/misc/perfetto-traces/pivo-performance-$TIMESTAMP.perfetto-trace"
readonly DURATION_MILLIS=$((DURATION_SECONDS * 1000))

mkdir -p "$OUTPUT_DIR"

cat > "$CONFIG_FILE" <<EOF
duration_ms: $DURATION_MILLIS
flush_period_ms: 1000

buffers {
  size_kb: 131072
  fill_policy: RING_BUFFER
}
buffers {
  size_kb: 65536
  fill_policy: RING_BUFFER
}

data_sources {
  config {
    name: "linux.ftrace"
    target_buffer: 0
    ftrace_config {
      buffer_size_kb: 16384
      drain_period_ms: 250
      compact_sched { enabled: true }
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_waking"
      ftrace_events: "sched/sched_wakeup_new"
      ftrace_events: "sched/sched_process_exit"
      ftrace_events: "sched/sched_process_free"
      ftrace_events: "power/cpu_frequency"
      ftrace_events: "power/cpu_idle"
      ftrace_events: "binder/binder_transaction"
      ftrace_events: "binder/binder_transaction_received"
      atrace_categories: "am"
      atrace_categories: "camera"
      atrace_categories: "dalvik"
      atrace_categories: "gfx"
      atrace_categories: "hal"
      atrace_categories: "input"
      atrace_categories: "view"
      atrace_categories: "wm"
      atrace_apps: "$PACKAGE"
    }
  }
}

data_sources {
  config {
    name: "linux.process_stats"
    target_buffer: 0
    process_stats_config {
      scan_all_processes_on_start: true
      proc_stats_poll_ms: 1000
    }
  }
}

data_sources {
  config {
    name: "android.surfaceflinger.frametimeline"
    target_buffer: 0
  }
}

data_sources {
  config {
    name: "android.gpu.memory"
    target_buffer: 0
  }
}

data_sources {
  config {
    name: "android.packages_list"
    target_buffer: 0
  }
}

data_sources {
  config {
    name: "linux.perf"
    target_buffer: 1
    perf_event_config {
      timebase {
        counter: SW_CPU_CLOCK
        frequency: $SAMPLE_FREQUENCY
        timestamp_clock: PERF_CLOCK_MONOTONIC
      }
      callstack_sampling {
        scope {
          target_cmdline: "$PACKAGE"
        }
        kernel_frames: true
      }
    }
  }
}
EOF

cleanup() {
    "${ADB[@]}" shell rm -f "$REMOTE_TRACE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '%s (PID %s)를 %s초 동안 %sHz로 기록합니다...\n' \
    "$PACKAGE" "$APP_PID" "$DURATION_SECONDS" "$SAMPLE_FREQUENCY"

"${ADB[@]}" shell rm -f "$REMOTE_TRACE"
"${ADB[@]}" shell perfetto --txt -c - -o "$REMOTE_TRACE" < "$CONFIG_FILE"
"${ADB[@]}" pull "$REMOTE_TRACE" "$TRACE_FILE" >/dev/null

[[ -s "$TRACE_FILE" ]] || fail "Trace를 가져오지 못했거나 파일이 비어 있습니다"

{
    printf 'recorded_at=%s\n' "$TIMESTAMP"
    printf 'package=%s\n' "$PACKAGE"
    printf 'pid=%s\n' "$APP_PID"
    printf 'duration_seconds=%s\n' "$DURATION_SECONDS"
    printf 'sample_frequency_hz=%s\n' "$SAMPLE_FREQUENCY"
    printf 'android_serial=%s\n' "$("${ADB[@]}" get-serialno | tr -d '\r')"
    printf 'device_model=%s\n' "$("${ADB[@]}" shell getprop ro.product.model | tr -d '\r')"
    printf 'device_build=%s\n' "$("${ADB[@]}" shell getprop ro.build.fingerprint | tr -d '\r')"
    printf 'trace=%s\n' "$TRACE_FILE"
} > "$METADATA_FILE"

printf '%s\n' \
    "기록이 완료됐습니다." \
    "Trace: $TRACE_FILE" \
    "설정: $CONFIG_FILE" \
    "메타데이터: $METADATA_FILE" \
    "https://ui.perfetto.dev 에서 trace를 여세요."
