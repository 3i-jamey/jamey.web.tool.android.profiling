# improved2 단일 추론 스레드 3자 비교 (20:45 before · 20:50 improved · 12:25 improved2)

## 대상

- before: `profiling/captures/20260728-204546-before.zip` · PID 18881
- improved: `profiling/captures/20260728-205004-improved.zip` · PID 20213
- improved2: `profiling/captures/20260729-122518-improved2.zip` · PID 886 (다음날 별개 실행)
- 공통: `SM-A566B`, `app.pivo.android.capture.dev`, 10초, perf 100Hz. 세 캡처 모두 계측 marker 포함.

## 결론

improved2는 improved의 실행률 회귀를 대부분 회복하면서 improved의 이득을 유지했다. 구조가 바뀌었다: `ML-Inference-0/1` 2-스레드 교대가 **`YoloInference` 단일 전용 스레드**로, 프레임 처리는 **`Frame-Processin`** 스레드로 분리됐다.

- 실행률: 7.3/s → 5.6/s → **6.5/s** (before의 89%까지 회복)
- 추론 후 유휴 gap: 1.4ms → 60.0ms → **16.9ms**
- 추론 1회당 앱 CPU: 237.8ms → 249.3ms → **225.3ms** (셋 중 최저)
- `FrameImageProxy` 꼬리: p99 6.09 → 5.74 → **4.03ms**, max 10.46 → 8.11 → **4.25ms**
- FrameTimeline: 595 frame **전부 `None`** — 세 캡처 중 유일하게 stuffing 0

남은 문제는 두 가지다. ① 아직 8회의 산발적 130ms 스톨이 있어 그 구간에서 간격이 7~9프레임으로 벌어진다. ② **RSS가 +100MiB 늘었다**(410 → 511MiB). 별개 실행이라 장면 차이일 수 있지만 확인이 필요하다.

## 3자 비교표

| 항목 | before | improved | improved2 |
|---|---:|---:|---:|
| 앱 전체 CPU | 17,360ms | 13,962ms | 14,647ms |
| `YOLO.run` 횟수 | 73 (7.3/s) | 56 (5.6/s) | **65 (6.5/s)** |
| `YOLO.run` 1회 wall median | 126.6ms | 129.0ms | **116.8ms** |
| 추론 스레드 CPU / 1회 | 132.6ms | 133.3ms | **118.3ms** |
| 추론 1회당 앱 CPU | 237.8ms | 249.3ms | **225.3ms** |
| 시작 간격 median | 133.1ms | 195.9ms | **134.6ms** |
| 종료→다음 시작 gap median | 1.4ms | 60.0ms | 16.9ms |
| gap p90 | 8.4ms | 69.9ms | 127.2ms |
| 추론 점유율 | 94.3% | 71.5% | 77.3% |
| 실행 스레드 | `DefaultDispatch` 8개 | `ML-Inference-0/1` | **`YoloInference` 단일** |
| `Detection` 횟수 | 148 | 148 | 149 |
| `FrameImageProxy` median / p99 / max | 1.12 / 6.09 / 10.46ms | 0.70 / 5.74 / 8.11ms | **0.65 / 4.03 / 4.25ms** |
| FrameTimeline stuffing | 563/594 | 449/599 | **0/595** |
| 평균 RSS | 407.9MiB | 410.5MiB | **511.5MiB (+100.6)** |
| RSS anon | 194.3MiB | 196.4MiB | **275.9MiB (+81.6)** |
| GPU Memory | 52.4MiB | 19.8MiB | 16.6MiB |
| HWUI All Memory | 16.3MiB | 5.8MiB | 5.1MiB |
| CPU7 평균 주파수 | 1,946MHz | 1,837MHz | 2,379MHz (max 2,784) |

## cadence 상세

간격을 카메라 프레임 주기(33ms) 배수로 보면:

| 배수 | before | improved | improved2 |
|---|---:|---:|---:|
| 4프레임 (133ms) | 66 | 18 | **56** |
| 5~6프레임 | 6 | 36 | 0 |
| 7~9프레임 (스톨) | 0 | 1 | **8** |

improved의 "6프레임 간격 35회" 문제(추론 종료 후 다음 Detection 틱까지 60ms 대기)는 사라졌다. improved2는 기본 4프레임 cadence로 돌아왔고, 대신 캡처당 8회의 산발 스톨(gap 110~142ms ≈ Detection 2틱 놓침)이 남았다. 스톨은 2.1초, 2.5초, 6.6~8.1초(5회 밀집), 9.7초에 나타났다.

## 1회 추론이 9% 빨라진 것에 대한 유보

`YOLO.run` wall median 116.8ms(-9.4% vs improved)와 스레드 CPU/1회 118.3ms(-11.3%)는 실측이다. 다만 improved2의 CPU7 평균 주파수가 2,379MHz로 improved(1,837MHz)보다 29% 높았다 — 기기 재부팅(PID 886) 직후의 낮은 열 상태로 보인다. **모델·코드가 빨라진 게 아니라 클럭이 높았던 것일 수 있다.** cycles 기준으로는 개선 없음에 가깝다(116.8ms × 2,379MHz ≈ 129.0ms × 1,837MHz의 1.17배). 1회 비용 개선을 주장하려면 같은 열 상태에서 재측정이 필요하다.

같은 이유로 improved2의 stuffing 0도 코드 개선과 클럭 여유가 섞인 결과일 수 있다. 다만 `FrameImageProxy` p99·max 감소와 stuffing 0의 방향은 `Frame-Processin` 분리 구조와 부합한다.

## 메모리 — 확인 필요

RSS anon이 +81.6MiB다. GPU·HWUI 메모리는 오히려 줄었으므로 증가분은 힙/네이티브 할당이다. 후보: `Nv21BufferPool` 크기, 단일 스레드 큐의 프레임 보관, 장면 차이(피사체 수), 실행 시점 차이. 같은 장면으로 before/improved2를 재수집해 분리해야 한다.

## 우선 조치

1. 산발 스톨 8회의 원인 조사 — 6.6~8.1초에 5회 밀집한다. 해당 구간의 `Detection` 틱과 카메라 프레임 도착을 대조하면 공급 문제인지 스킵 가드 문제인지 갈린다.
2. RSS +100MiB를 같은 장면 재수집으로 확인.
3. 1회 118ms vs 129ms는 열 상태 차이가 섞여 있으므로 warm 상태 재측정으로 판정.
4. 다음 최적화 레버는 여전히 `YOLO.run` 자체다(추론 점유율 77%, perf leaf 745/전체가 `libLiteRtRuntimeCApi.so`).
