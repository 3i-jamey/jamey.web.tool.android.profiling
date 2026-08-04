# SurfaceFlinger·BLAST 큐 기준 캡처 비교 (18:58:08 vs 18:58:56)

## 대상

- 기준: `profiling/captures/20260728-185808.zip`
- 비교: `profiling/captures/20260728-185856.zip`
- 공통 환경: `SM-A566B`, Android 16, `app.pivo.android.capture.dev` versionCode 11921, PID 5079, 10초, perf 100Hz
- 두 ZIP의 Perfetto config는 동일하다.
- 두 캡처는 같은 PID에서 48초 간격으로 기록됐다. 코드 A/B 이름은 ZIP에 없지만 perf stack과 JIT slice상 기준은 NCNN/TNN, 비교는 LiteRT 경로다.

## 결론

두 번째 캡처는 추론 backend가 NCNN/TNN에서 LiteRT로 바뀌며 앱 CPU를 `28.827 → 14.408 CPU초`로 50.0% 줄였다. detection은 두 캡처 모두 149회로 동일하므로 처리량을 낮춰 얻은 개선이 아니다. 추론 워커 CPU도 detection당 `141.83 → 57.31 CPU ms`로 59.6% 줄었다.

그러나 화면 표시 상태는 크게 악화됐다. 두 번째 캡처의 `MainActivity` BLAST 큐는 기준보다 버퍼 한 장 더 깊고, 594 frame 전부가 `Buffer Stuffing, SurfaceFlinger Stuffing`으로 판정됐다. Actual FrameTimeline 평균 duration은 `6.55 → 27.47ms`, expected deadline 대비 완료 시각은 평균 `9.49ms 이전 → 11.59ms 이후`로 바뀌었다.

직접 원인은 앱 계산량이 아니라 표시 파이프라인의 버퍼 대기다. 두 번째 캡처에서 `dequeueBuffer - VRI[MainActivity]`는 평균 7.60ms 대기했고, `HWC release`와 `GPU completion`의 `waitForever`가 각각 8.18초와 8.96초 누적됐다. 앱 CPU는 절반으로 줄고 SurfaceFlinger CPU는 5.1%만 늘었으므로 CPU 포화로 설명할 수 없다.

## 전체 비교

| 항목 | 18:58:08 | 18:58:56 | 차이 |
|---|---:|---:|---:|
| trace 길이 | 9.9999초 | 9.9996초 | 동일 |
| 앱 CPU 시간 | 28.827 CPU초 | 14.408 CPU초 | -50.0% |
| 평균 코어 점유 | 2.88코어 | 1.44코어 | -1.44코어 |
| 앱 sched 실행 횟수 | 42,182 | 32,334 | -23.3% |
| Actual frame | 596 | 594 | 사실상 동일한 60Hz |
| Actual frame 평균 duration | 6.55ms | 27.47ms | +319.5% |
| Actual frame 최대 duration | 12.51ms | 37.08ms | +196.3% |
| FrameTimeline jank 분류 | SF Stuffing 596 | Buffer+SF Stuffing 594 | 비교 캡처 악화 |
| expected deadline 대비 평균 완료 | 9.49ms 이전 | 11.59ms 이후 | +21.08ms 이동 |
| App Deadline Missed | 0 | 0 | 동일 |
| SurfaceFlinger CPU | 1.643 CPU초 | 1.727 CPU초 | +5.1% |
| 평균 RSS | 423.57MiB | 470.53MiB | +46.96MiB |
| GPU Memory | 14.13MiB | 26.02MiB | +11.89MiB |

기준 캡처도 596 frame 전부 `SurfaceFlinger Stuffing`이므로 완전히 정상인 캡처는 아니다. 다만 모든 frame이 expected deadline보다 평균 9.49ms 일찍 끝났고 `Buffer Stuffing`은 없었다. 두 번째 캡처에 새로 생긴 `Buffer Stuffing`과 양의 deadline 초과가 체감 latency에 더 직접적인 회귀다.

## 추론 CPU 개선

| 항목 | NCNN/TNN · 18:58:08 | LiteRT · 18:58:56 | 차이 |
|---|---:|---:|---:|
| `Detection` slice 수 | 149 | 149 | 동일 |
| 주 추론 워커 | `DefaultDispatch` 28개 | `ML-Inference-0` 1개 | 병렬 모델 변경 |
| 주 추론 워커 CPU | 21,132.4ms | 8,539.6ms | -59.6% |
| detection당 주 워커 CPU | 141.83ms | 57.31ms | -59.6% |
| 앱 메인 스레드 CPU | 2,311.6ms | 1,647.8ms | -28.7% |
| `RenderThread` CPU | 1,510.5ms | 1,439.5ms | -4.7% |
| `CameraX-GL Thre` CPU | 814.8ms | 555.2ms | -31.9% |

기준 perf leaf는 `libcoreInference-lib.so`, `sched_yield`, `do_sched_yield`, `libTNN.so`의 `kmp_flag_64::wait`가 지배적이다. CPU 4~7에 각각 5.30~5.86 CPU초가 분산되어 OpenMP 병렬 실행과 대기가 큰 비용을 냈다.

비교 perf leaf 799개는 `libLiteRtRuntimeCApi.so`에 집중됐다. `ML-Inference-0`은 CPU 7에서 주로 실행되어 앱의 CPU 7 사용이 8.06 CPU초인 반면 CPU 0~3 사용은 합계 60.7ms에 불과하다. 동일 detection 횟수에서 CPU 총량이 절반이므로 추론 CPU 효율은 LiteRT가 명확히 우세하다.

`Detection` slice 자체는 평균 0.165ms와 0.114ms로 실제 추론 wall 구간을 감싸지 않는다. 위 detection당 수치는 동작량을 맞춘 CPU 비용이며, 1회 추론 latency로 읽으면 안 된다.

## 표시 파이프라인 회귀

### BLAST 큐 깊이

`transactionCallback`의 `(f:0,a:N)` 및 `QueuedBuffer` counter는 비교 캡처에서 `MainActivity` 큐가 정확히 한 칸 깊어진 것을 보여준다.

| MainActivity VRI 큐 | 18:58:08 | 18:58:56 |
|---|---:|---:|
| callback `a:2` | 589 | 0 |
| callback `a:3` | 5 | 593 |
| callback `a:4` | 0 | 1 |
| `QueuedBuffer` counter 값 | 2·3 중심 | 3·4만 존재 |

반면 preview `SurfaceView` callback은 두 캡처 모두 `a:1` 중심이고 `a:2`가 각각 25회와 22회뿐이다. 즉 깊어진 큐는 preview SurfaceView 자체가 아니라 `VRI[MainActivity]` 쪽이다.

### 버퍼 대기

| 항목 | 18:58:08 | 18:58:56 | 차이 |
|---|---:|---:|---:|
| `dequeueBuffer - VRI[MainActivity]` | 593회 · 총 52.4ms · 평균 0.088ms | 593회 · 총 4,505.4ms · 평균 7.598ms | 대기 급증 |
| `GPU completion` · `waitForever` | 887회 · 총 1,426.4ms · 평균 1.608ms | 884회 · 총 8,957.9ms · 평균 10.133ms | +7,531.5ms |
| `HWC release` · `waitForever` | 없음 | 594회 · 총 8,177.4ms · 평균 13.767ms | 비교에서 새로 발생 |
| `queueBuffer` | 2,380회 · 총 873.8ms | 2,376회 · 총 910.2ms | 작업량 유사 |

생산 측의 `queueBuffer` 횟수는 같고, 소비·release를 기다리는 시간이 늘었다. 이는 프레임 생산량이나 앱 CPU 부족보다 BLAST/HWC/GPU present 큐의 backpressure를 지목한다.

### 시간에 따른 상태

| 초 | 18:58:08 frame 수 · 평균 duration | 18:58:56 frame 수 · 평균 duration | 비교 deadline 초과 |
|---:|---|---|---:|
| 0 | 60 · 7.34ms | 60 · 35.41ms | 19.52ms |
| 1 | 60 · 6.74ms | 60 · 35.42ms | 19.59ms |
| 2 | 60 · 6.37ms | 60 · 35.46ms | 19.61ms |
| 3 | 60 · 7.38ms | 59 · 35.43ms | 19.62ms |
| 4 | 60 · 5.94ms | 60 · 35.61ms | 19.72ms |
| 5 | 60 · 6.15ms | 59 · 21.51ms | 5.69ms |
| 6 | 60 · 5.91ms | 60 · 18.78ms | 2.89ms |
| 7 | 59 · 6.05ms | 60 · 18.84ms | 2.91ms |
| 8 | 60 · 7.67ms | 60 · 18.87ms | 2.91ms |
| 9 | 57 · 5.90ms | 56 · 18.88ms | 2.92ms |

두 번째 캡처는 처음 5초 동안 약 두 vsync 늦고, 이후 한 vsync 정도로 일부 회복한다. 하지만 `MainActivity` 큐 깊이는 끝까지 `a:3`이고 모든 frame의 `Buffer Stuffing`도 유지된다. 따라서 FPS 회복이 아니라 latency가 약 35ms에서 19ms로 한 단계 줄어든 것이다.

## 캡처 사이 재구성 정황

- 기준 preview surface: `b5e67a5 SurfaceView[...]@0#3`
- 비교 preview surface: `f0bfc4c SurfaceView[...]@0#5`
- 기준 ImageReader counter: `ImageReader-1280x720f23m4-5079-8`
- 비교 ImageReader counter: `ImageReader-1280x720f23m4-5079-24`
- `MainActivity` VRI 식별자 `@540c74e#0`은 두 캡처에서 동일하다.

같은 PID인데 SurfaceView와 ImageReader 식별자가 바뀌었으므로 두 캡처 사이에 카메라/preview surface가 재구성됐다. 재구성 뒤 기존 VRI 큐가 한 칸 깊어진 정황은 강하지만, 재구성 순간이 trace 시작 전이라 인과를 확정할 수는 없다.

## 메모리

| 항목 | 18:58:08 | 18:58:56 | 차이 |
|---|---:|---:|---:|
| 평균 RSS | 423.57MiB | 470.53MiB | +46.96MiB |
| 평균 anonymous RSS | 203.51MiB | 245.11MiB | +41.60MiB |
| file RSS | 216.21MiB | 221.20MiB | +4.99MiB |
| RSS watermark | 458.09MiB | 485.00MiB | +26.91MiB |
| 가상 메모리 | 23,833.80MiB | 24,391.02MiB | +557.22MiB |
| GPU Memory | 14.13MiB | 26.02MiB | +11.89MiB |

두 번째 캡처 내부에서도 RSS가 `473.36 → 479.41MiB`로 6.05MiB 증가했다. 다만 같은 PID의 후속 캡처이므로 46.96MiB 차이에는 backend 변경, surface 재구성, 두 캡처 사이 누적 할당이 모두 섞여 있다. cold-start 프로세스를 분리하기 전에는 전부 LiteRT 비용이라고 단정할 수 없다.

## 우선 조치

1. 추론 backend 성능은 LiteRT 쪽을 유지한다. 동일 detection 149회에서 앱 CPU -50.0%, 추론 워커 CPU -59.6%가 확인됐다.
2. preview surface 재구성 직전부터 trace를 시작한다. 재구성 직후 `QueuedBuffer - VRI[MainActivity]`, `dequeueBuffer`, `HWC release`, `GPU completion`이 어떤 순서로 한 단계 증가하는지 확인한다.
3. SurfaceView/ImageReader 교체 경로의 lifecycle과 release 완료를 점검한다. 이전 surface의 buffer/fence가 남은 상태에서 새 surface를 연결하는지, `Surface.release`, ImageReader close, CameraX bind/unbind 순서를 확인한다.
4. 18:58:56 캡처와 같은 상태에서 preview pipeline을 재시작하지 않고 BLAST 큐가 자연 회복하는지 더 길게 측정한다. 현재는 10초 내 duration만 35ms에서 19ms로 줄고 큐 깊이는 회복하지 않았다.
5. 메모리는 NCNN과 LiteRT를 각각 별도 cold-start PID에서 같은 동작량으로 재수집한다.
6. 실제 추론 시작/종료에 `Trace.beginSection/endSection`을 추가한다. 그래야 CPU 비용 외에 backend별 p50/p90 wall latency를 비교할 수 있다.

## 측정 한계

- 두 캡처는 같은 PID의 서로 다른 시점이다. 파일명만으로 실험군 라벨이나 캡처 사이 수행 동작을 알 수 없다.
- 기준 perf sample 2,757개 중 67.6%, 비교 1,419개 중 28.9%에 unwind error가 있다. 함수·심볼 sample은 backend와 방향 확인용으로만 사용했다.
- CPU 시간은 `sched_slice` 기반이고 frame 수·duration·jank는 `actual_frame_timeline_slice` 기반이므로 perf unwind error와 무관하다.
- expected deadline 차이는 같은 `surface_frame_token`의 Actual·Expected FrameTimeline end 시각을 매칭해 계산했다.
- BLAST 큐 깊이는 atrace callback의 `(f:0,a:N)`과 `QueuedBuffer` counter가 같은 방향임을 교차 확인한 해석이다.
- 두 trace 모두 `ftrace_setup_errors=38`이지만 설정과 값이 같고, CPU·FrameTimeline·counter 데이터는 두 캡처 모두 존재한다.

## 분석 도구

- Perfetto Trace Processor `v57.2-da1d152cf`
- 전체 10초 구간의 `sched_slice`, `actual_frame_timeline_slice`, `expected_frame_timeline_slice`, `slice`, `counter`, `perf_sample`을 SQL로 집계했다.
