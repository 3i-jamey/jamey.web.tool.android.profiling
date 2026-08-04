# NV21·RGBA 경로 Perfetto 비교 (09:39 · 09:41)

## 대상과 조건

- 기준선: `profiling/captures/20260731-093932.zip` · PID 28259
- 비교: `profiling/captures/20260731-094110.zip` · PID 29257
- 공통: `SM-A566B`, Android 16, `app.pivo.android.capture.dev`, versionCode 11921, 약 10초, perf 100Hz
- 경로 근거: 기준선 stack에는 `processFrameWithNv21Buffer`·`preprocessNv21`이, 비교 stack에는 `processFrameWithRgbaBuffer`·`preprocessRgba`·`nativePreprocessRgba8888`이 관측됐다.
- 비교기는 FrameTimeline cadence가 유사한 9초 구간(539·540 frame)을 맞춰 CPU·메모리·함수 표본을 비교했다. 프레임과 이벤트의 초 단위 분포는 전체 trace를 추가 조회했다.

## 결론

비교 캡처의 RGBA 경로는 화면 파이프라인 안정성이 크게 좋아졌다. 전체 trace에서 기준선은 598 frame 중 243개(40.6%)가 stuffing이지만 비교 캡처는 604 frame 전부 `None`이다. 비교 캡처는 ImageReader callback도 약 30/s에서 59/s로 두 배 받았다.

그러나 앱 CPU는 같은 9초 동안 14.778초에서 14.996초로 1.5% 늘었다. 따라서 RGBA 경로를 CPU 최적화로 판정할 수는 없다. 성능 특성은 "더 많은 카메라 callback과 RGBA 변환 비용을 감당하면서 화면 안정성을 확보했지만 전체 CPU는 소폭 증가"로 요약된다.

중요한 유보가 있다. 기준선 stuffing은 trace 시작부터 약 4초까지만 연속 발생하고 이후에는 사라진다. 비교 캡처는 처음부터 끝까지 깨끗하다. 이 차이는 코드 효과일 수도 있지만 첫 캡처만 pipeline warm-up·초기 queue backlog 상태였을 가능성도 있다. 동일 warm-up 시간과 동일 장면으로 반복 측정하기 전에는 stuffing 개선을 RGBA 전환의 인과 효과로 확정하면 안 된다.

## 핵심 수치

| 항목 | 09:39 NV21 | 09:41 RGBA | 변화 |
|---|---:|---:|---:|
| 앱 CPU, matched 9초 | 14,778ms | 14,996ms | +218ms, +1.5% |
| 평균 사용 코어 환산 | 1.642 core | 1.666 core | +0.024 core |
| FrameTimeline, 전체 trace | 598 | 604 | 비슷 |
| stuffing, 전체 trace | 243/598 (40.6%) | 0/604 (0%) | -40.6%p |
| 실제 frame 평균 duration, matched 9초 | 6.375ms | 5.804ms | -8.9% |
| 실제 frame 최대 duration, matched 9초 | 19.539ms | 10.104ms | -48.3% |
| `Detection` 실행 | 149 | 150 | 사실상 동일 |
| `Detection` 평균 간격 | 66.56ms | 66.77ms | 사실상 동일, 약 15/s |
| `Detection` 평균 duration | 0.246ms | 0.223ms | -9.3% |
| ImageReader callback, 전체 trace | 297 (약 29.7/s) | 597 (약 59.3/s) | 약 2배 |
| 평균 RSS, matched 9초 | 440.0MiB | 440.7MiB | +0.7MiB |
| 최대 RSS | 458.3MiB | 457.4MiB | -0.9MiB |
| 종료 RSS | 427.6MiB | 457.4MiB | +29.8MiB |

## 화면 파이프라인

기준선의 jank 분포는 시간에 강하게 치우쳤다.

| trace 상대 구간 | 기준선 | 비교 |
|---|---|---|
| 0초 | Buffer+SF Stuffing 50 · SF Stuffing 9 | None 60 |
| 1초 | SF Stuffing 60 | None 60 |
| 2초 | SF Stuffing 61 | None 61 |
| 3초 | SF Stuffing 60 | None 60 |
| 4초 | SF Stuffing 3 · None 56 | None 60 |
| 이후 | 전부 None | 전부 None |

기준선은 약 4초 뒤 steady state로 회복한다. 자동 선택된 대표 1초 구간도 기준선 61/61, 비교 61/61 모두 `None`이었다. 따라서 전체 trace의 40.6% stuffing과 steady-state의 0% stuffing을 분리해서 봐야 한다.

GC가 직접 원인이라는 근거는 약하다. 기준선 stuffing은 첫 GC(1.22초) 전부터 연속 발생했고, 비교 캡처도 1.88초에 75ms young GC가 있었지만 jank가 없었다. 기준선의 초기 buffer queue/backpressure 또는 warm-up 상태를 먼저 조사하는 편이 맞다.

## CPU 경로 변화

스케줄러 CPU 기준 주요 이동은 다음과 같다.

| 스레드 | NV21 | RGBA | 변화 |
|---|---:|---:|---:|
| `DefaultDispatch` | 8,136ms | 8,495ms | +359ms, +4.4% |
| 앱 main (`oid.capture.dev`) | 1,771ms | 1,854ms | +82ms, +4.6% |
| `RenderThread` | 1,162ms | 1,187ms | +25ms, +2.2% |
| `CameraX-GL Thre` | 629ms | 655ms | +26ms, +4.1% |
| `CameraX-camerax` | 98ms | 345ms | +246ms, +250% |
| `ML-Inference-0/1` 합계 | 580ms | 416ms | -165ms, -28.4% |
| `HeapTaskDaemon` | 372ms | 61ms | -311ms, -83.5% |

RGBA 변환 비용은 주로 `CameraX-camerax` 증가로 나타났고, 기존 ML-Inference 스레드 비용은 줄었다. 반면 전체 CPU는 1.5% 증가했으므로 비용이 제거되기보다는 경로와 스레드가 바뀐 것으로 보는 편이 안전하다.

100Hz perf 표본에서 `libLiteRtRuntimeCApi.so` 추정 inclusive on-CPU는 7.64초에서 8.09초로 5.9% 늘었다. `ItemDetector.performInference` continuation도 1.64초에서 1.98초로 늘었다. 다만 unwind error 비율이 각각 28.2%, 27.2%이고 정확한 inference 실행 marker가 없으므로, 이 수치는 호출 횟수나 1회 latency가 아니라 CPU 표본 변화로만 해석해야 한다.

고성능 코어 평균 클럭은 비교 캡처가 약 2% 낮았다. 두 캡처의 열·클럭 조건은 대체로 비슷하며, 비교 캡처의 결과가 더 높은 클럭으로 얻어진 것은 아니다.

## 메모리와 GC

평균·최대 RSS는 사실상 같다. 비교 캡처의 종료 RSS만 29.8MiB 높지만 최대 RSS는 오히려 0.9MiB 낮다. 기준선은 matched 9초 동안 background GC 5회, 비교는 1회였고 `HeapTaskDaemon` CPU도 크게 줄었다. 종료 시점 차이는 비교 캡처가 아직 GC를 하지 않아 anon RSS를 보유한 상태일 가능성이 크며, 이 한 쌍만으로 누수로 판정할 수 없다.

GC 감소는 CPU 절감 요소지만 기준선의 화면 stuffing을 직접 설명하지는 못한다. 기준선의 stuffing 구간과 GC 구간이 완전히 일치하지 않고, 비교 캡처의 GC 중에도 frame은 모두 정상이다.

## 부가 회귀 신호

- 동기 Binder transaction 수는 286회에서 293회로 2.4% 증가했다.
- Binder active duration은 308.7ms에서 361.7ms로 17.2%, 평균 duration은 1.079ms에서 1.235ms로 14.4% 증가했다.
- 최대 Binder duration은 9.61ms에서 8.65ms로 줄어 긴 단발성 stall은 악화되지 않았다.
- 비교 캡처는 5개 더 많은 thread를 보유했다(45 → 50).

## 다음 검증

1. 앱 진입 후 고정 warm-up(예: 10초)을 준 뒤 NV21·RGBA를 각각 3회 이상 교차 수집한다.
2. `YOLO.run` 또는 inference 전체 구간에 안정적인 `Trace.beginSection/endSection` marker를 넣어 실행 횟수, 1회 wall duration, 실행 간격을 비교한다.
3. 동일 카메라 FPS를 강제한다. 현재 ImageReader callback이 30/s와 60/s로 달라 입력 조건이 동일하지 않다.
4. 초기 0~4초의 BufferQueue depth와 SurfaceFlinger stuffing 원인을 따로 확인한다. steady-state CPU 비교와 startup pipeline 비교를 한 판정으로 합치지 않는다.
5. 메모리는 60초 이상 수집해 GC 직후 RSS·anon 기준으로 비교한다.

## 측정 한계

- 정확한 operation count는 `Detection` marker만 확인할 수 있었다. 일반 함수의 perf sample 수를 실행 횟수로 사용하지 않았다.
- FrameTimeline stuffing은 pipeline/backpressure 분류이며 체감 dropped frame 수와 동일하지 않다.
- 두 캡처는 versionCode가 같지만 APK 설치 경로와 실행 PID가 다르고 실제 처리 경로도 NV21·RGBA로 다르다.
- CPU·메모리 비교는 cadence가 유사한 9초 공통 구간, 시간 분포와 전체 frame/event 수는 각 trace 전체를 사용했다.
