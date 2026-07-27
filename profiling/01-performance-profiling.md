# 로컬 성능 Trace 수집

`profiling/script/capture-performance.sh`는 실행 중인 Profile APK를 대상으로 다음 데이터를 같은 시간축의 Perfetto 파일 하나에 기록한다.

- CPU scheduling과 frequency
- 앱·CameraX·Binder·ART atrace section
- SurfaceFlinger FrameTimeline
- Process memory와 GPU memory
- `linux.perf` 기반 앱 CPU callstack

## 사전 준비

1. Android Studio에서 `RUN PROFILE apk`를 실행한다.
2. 측정할 화면과 tracking 상태까지 진입한다.
3. 터미널에서 캡처 스크립트를 실행한다.

```bash
./profiling/script/capture-performance.sh
```

기본 대상은 `app.pivo.android.capture.dev`, 기록 시간은 30초, callstack sampling은 CPU별 100Hz다.

## 자동 비교 구간

비교 도구는 별도 앱 marker 없이 FrameTimeline timestamp로 1000ms 분석 구간을 자동 선택한다.

- 기준선은 frame 수·median 간격·p90 간격이 전체 후보의 중앙 profile에 가장 가까운 대표 구간을 고른다.
- 비교 캡처는 기준선 profile과 가장 유사한 구간을 고른다.
- `actual_frame_timeline_slice`를 우선하고, 없으면 `expected_frame_timeline_slice`를 사용한다.
- FrameTimeline이 모두 없으면 두 trace의 중앙 1000ms를 사용한다.
- CPU 시간·frame duration·jank는 구간 선택에 쓰지 않고 선택된 구간의 비교 결과로만 사용한다.

선택된 1000ms 안에서 대상 앱의 atrace slice가 시작한 횟수는 operation별 `executionCount`로 기록된다. 특정 작업의 실제 실행 횟수를 비교하려면 그 작업을 안정적인 이름의 `Trace.beginSection/endSection`으로 계측해야 한다. CPU stack sample 수는 함수 호출 횟수로 사용하지 않는다.

## 옵션

10초만 기록:

```bash
./profiling/script/capture-performance.sh --duration 10
```

기록 시간과 sampling 주파수 지정:

```bash
./profiling/script/capture-performance.sh --duration 60 --frequency 150
```

다른 package 지정:

```bash
./profiling/script/capture-performance.sh \
  --package app.pivo.android.capture.dev \
  --duration 30
```

여러 기기가 연결된 경우 `ANDROID_SERIAL`을 지정한다.

```bash
ANDROID_SERIAL=5B270DLCR00594 ./profiling/script/capture-performance.sh
```

## 출력

기본 출력 위치:

```text
captures/YYYYMMDD-HHMMSS/
├─ config.textproto
├─ metadata.txt
└─ trace-YYYYMMDD-HHMMSS.perfetto-trace
```

`captures/`는 git에서 제외된다. 생성된 `.perfetto-trace`를 [Perfetto UI](https://ui.perfetto.dev)에 열면 System Trace와 CPU flamegraph를 동일한 구간에서 분석할 수 있다.

## 주의사항

- 대상 앱이 실행 중이지 않으면 스크립트가 중단된다.
- 앱 user callstack은 `profileable` 또는 `debuggable` APK에서만 기록된다.
- 긴 기록은 파일 크기와 기기 부하를 늘린다. 기본 100Hz를 권장하며 최대 200Hz로 제한한다.
- 캡처 중 앱을 재시작하면 최초 PID와 실제 데이터 구간이 달라질 수 있으므로 다시 수집한다.
