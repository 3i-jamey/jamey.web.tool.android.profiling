# 로컬 성능 Trace 수집

`.aimd/12-wiki/02-profiling/script/capture-performance.sh`는 실행 중인 Profile APK를 대상으로 다음 데이터를 같은 시간축의 Perfetto 파일 하나에 기록한다.

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
./.aimd/12-wiki/02-profiling/script/capture-performance.sh
```

기본 대상은 `app.pivo.android.capture.dev`, 기록 시간은 30초, callstack sampling은 CPU별 100Hz다.

## 옵션

10초만 기록:

```bash
./.aimd/12-wiki/02-profiling/script/capture-performance.sh --duration 10
```

기록 시간과 sampling 주파수 지정:

```bash
./.aimd/12-wiki/02-profiling/script/capture-performance.sh --duration 60 --frequency 150
```

다른 package 지정:

```bash
./.aimd/12-wiki/02-profiling/script/capture-performance.sh \
  --package app.pivo.android.capture.dev \
  --duration 30
```

여러 기기가 연결된 경우 `ANDROID_SERIAL`을 지정한다.

```bash
ANDROID_SERIAL=5B270DLCR00594 ./.aimd/12-wiki/02-profiling/script/capture-performance.sh
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
