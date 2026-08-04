# Android 프로파일링 캡처 비교

## 대상

- 기준: `profiling/captures/20260728-154000.zip`
- 비교: `profiling/captures/20260728-154038.zip`
- 공통 환경: `SM-A566B`, Android 16, `app.pivo.android.capture.dev`, PID 7306, 10초, perf 100Hz

## 결론

가장 큰 병목은 첫 캡처의 NCNN/TNN 추론 경로다. `DefaultDispatch` 이름의 워커들이 약 9.93초 동안 25.07 CPU초를 사용했고, 전체 앱 CPU의 76.3%를 차지했다. perf stack에는 `libTNN.so`의 `_ZN11kmp_flag_644waitEP8kmp_infoi`와 `sched_yield`가 반복되어 OpenMP 워커의 대기 방식도 상당한 CPU를 소비한 것으로 나타났다.

두 번째 캡처는 LiteRT 추론 경로로 바뀌면서 이 병렬 워커 병목이 사라졌다. 남은 가장 큰 병목은 단일 `ML-Inference-0` 스레드의 `libLiteRtRuntimeCApi.so` 실행이며 7.92 CPU초, 전체 앱 CPU의 54.8%다. 전체 CPU와 FrameTimeline 판정은 크게 좋아졌지만 RSS와 가상 메모리는 증가했다.

## 전체 캡처 비교

| 항목 | 15:40:00 | 15:40:38 | 차이 |
|---|---:|---:|---:|
| 프레임 활성 구간 | 9.928초 | 9.961초 | 유사 |
| 앱 CPU 시간 | 32.874 CPU초 | 14.452 CPU초 | -56.0% |
| 평균 코어 점유 | 3.31코어 | 1.45코어 | -1.86코어 |
| 스케줄 실행 횟수 | 70,568 | 35,381 | -49.9% |
| Actual frame | 596 | 593 | 사실상 동일한 60Hz |
| Actual frame 평균 duration | 6.95ms | 6.41ms | -7.7% |
| FrameTimeline jank 분류 | 596/596, 100% | 178/593, 30.0% | -70.0%p |
| App Deadline Missed | 1 | 0 | 개선 |
| 평균 RSS | 434.9MiB | 478.4MiB | +43.6MiB |
| 최대 RSS | 453.7MiB | 488.8MiB | +35.1MiB |
| 평균 가상 메모리 | 24,480.3MiB | 25,473.4MiB | +993.0MiB |

## CPU 병목

### 첫 캡처

- `DefaultDispatch`: 25.069 CPU초, 전체 CPU의 76.3%, 동일 이름 thread instance 26개
- 앱 메인 스레드: 2.315 CPU초
- `RenderThread`: 1.525 CPU초
- `CameraX-GL Thre`: 0.951 CPU초
- perf leaf sample: `libcoreInference-lib.so` 461개, `sched_yield` 224개, `do_sched_yield` 183개, TNN `kmp_flag_64::wait` 54개
- CPU 4~7 각각 6.34~6.58 CPU초를 사용하고 CPU 0~3도 1.45~2.05 CPU초를 사용해 부하가 여러 코어에 넓게 퍼졌다.

### 두 번째 캡처

- `ML-Inference-0`: 7.923 CPU초, 전체 CPU의 54.8%, 단일 thread instance
- 앱 메인 스레드: 1.917 CPU초, 첫 캡처 대비 -17.2%
- `RenderThread`: 1.354 CPU초, -11.2%
- `CameraX-GL Thre`: 0.670 CPU초, -29.5%
- `DefaultDispatch`: 0.300 CPU초로 첫 캡처보다 98.8% 감소
- perf leaf sample 738개가 `libLiteRtRuntimeCApi.so`에 집중됐다.
- CPU 7 사용량이 6.92 CPU초로 집중되어 LiteRT 단일 추론 스레드가 현재의 주 병목이다.

## 추론 경로 차이

첫 캡처 stack에는 다음 경로가 나타난다.

```text
NCNNProcessor -> libcoreInference-lib.so -> libTNN.so/OpenMP
```

두 번째 캡처 stack에는 다음 경로가 나타난다.

```text
YoloDetectionProcessor
  -> ItemTrackingPipeLine.processFrameWithNv21Buffer
  -> ItemDetector.detectWithTensorBuffer
  -> CompiledModel.run
  -> liblitert_jni.so
  -> libLiteRtRuntimeCApi.so
```

따라서 단순한 실행 편차가 아니라 추론 backend와 threading model 자체가 다르다.

## 프레임 차이

- 첫 캡처 596 frame은 모두 FrameTimeline jank type이 지정됐다: `Buffer Stuffing` 384, `SurfaceFlinger Stuffing` 187, 둘 다 24, `App Deadline Missed` 1.
- 두 번째는 `None` 415, `SurfaceFlinger Stuffing` 173, 복합 stuffing 5이며 `App Deadline Missed`는 없다.
- cadence를 맞춘 대표 1초 구간에서도 첫 캡처 61 frame은 모두 `Buffer Stuffing`, 두 번째 61 frame은 모두 `None`이었다.
- frame 수는 거의 같으므로 두 번째 결과는 FPS를 낮춰 CPU를 절약한 형태가 아니다.
- 다만 stuffing은 FrameTimeline의 pipeline/backpressure 분류이며 화면에서 체감한 dropped frame 수와 동일하다고 단정하면 안 된다. 명확한 deadline miss는 첫 캡처 1건뿐이다.

대표 1초의 UI slice는 두 번째가 일부 더 길었다.

- `traversal` 평균: 2.14ms -> 2.54ms, +18.6%
- `draw-VRI` 평균: 2.03ms -> 2.43ms, +20.1%
- `Choreographer#scheduleVsyncLocked` 평균: 0.119ms -> 0.225ms, +88.5%

절대 시간은 frame budget보다 작고 최대값은 오히려 감소했으므로 현재의 1순위 병목은 아니다.

## 메모리와 GC

- 두 번째 평균 RSS는 43.6MiB, anonymous RSS는 약 36.8MiB, file RSS는 약 6.4MiB 높다.
- 첫 캡처 내부 RSS는 431.1 -> 451.7MiB로 20.6MiB 증가했다.
- 두 번째 내부 RSS는 482.3 -> 485.0MiB로 2.7MiB 증가했다.
- 두 캡처가 동일 PID에서 38초 간격으로 수집되어 두 번째 값에는 첫 실행의 잔존 할당과 캡처 사이 할당이 포함된다. 현재 자료만으로 +43.6MiB 전부를 LiteRT 비용이라고 단정할 수 없다.
- young concurrent GC는 각각 1회이며 58.7ms와 45.9ms였다. GC는 주 병목이 아니다.

## 우선 조치

1. NCNN/TNN 경로를 유지해야 한다면 TNN/OpenMP worker 수와 wait policy를 먼저 조정한다. `kmp_flag_64::wait -> sched_yield` 반복과 과도한 `DefaultDispatch` worker가 줄어드는지 재측정한다.
2. 성능 기준으로는 두 번째 LiteRT 경로가 우세하다. 남은 병목은 `ML-Inference-0`이므로 model quantization, delegate, 입력 크기, frame skipping을 검토한다.
3. inference 시작/종료에 안정적인 `Trace.beginSection/endSection`을 추가한다. 현재 perf sample은 함수 호출 횟수나 1회 latency를 제공하지 않으므로 backend별 처리량과 p90 latency는 판정할 수 없다.
4. 메모리는 각 backend를 별도 cold-start PID로 실행해 같은 동작 후 재수집한다. 그래야 runtime 자체 RSS와 누적 할당을 분리할 수 있다.

## 측정 한계

- 첫 캡처 perf sample 3,290개 중 2,374개(72.2%), 두 번째 1,454개 중 377개(25.9%)에 unwind error가 있다. 함수별 sample 수는 방향 확인용으로만 사용했다.
- CPU 시간과 thread 상태는 `sched_slice` 기반이므로 unwind error와 무관한 정량 근거다.
- inference operation이 atrace section으로 계측되지 않아 추론 횟수, 1회 wall latency, 처리 frame 수는 측정할 수 없다.
