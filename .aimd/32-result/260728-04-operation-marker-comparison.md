# 계측 marker 기준 비교 — YOLO · Tracking.update · FrameImageProxy (20:45:46 vs 20:50:04)

## 대상

- 기준(before): `profiling/captures/20260728-204546-before.zip` · PID 18881
- 비교(improved): `profiling/captures/20260728-205004-improved.zip` · PID 20213
- 두 캡처에는 앱 계측 marker가 들어 있다. `FrameImageProxy`는 async slice(`atrace_async_slice`), 나머지는 thread slice다.
- 앞선 `182100`·`182127` 캡처에는 이 marker가 없다. 이 쌍에서만 비교 가능하다.

## 결론 — 260728-03의 정정

**추론 1회당 비용은 줄지 않았다.** `YOLO.run`의 1회 wall duration은 129.43ms → 128.05ms로 1.1% 차이이고, 추론 스레드 CPU를 실행 횟수로 나눈 값도 139.8 → 138.7 CPU ms로 0.8% 차이다.

`260728-03`에서 보고한 **추론 경로 CPU -23.9%는 전부 실행 횟수 감소 때문이다.** `YOLO.run`이 73회 → 56회(-23.3%)로 줄었다. 초당 7.3회 → 5.6회다. 앱 전체 CPU 감소분 3,397.6ms 중 2,376.6ms(70%)가 "추론 17회를 덜 한 것"으로 설명된다.

**실제로 1회당 빨라진 것은 프레임 처리 glue다.** `FrameImageProxy`는 실행 횟수가 296 → 297로 같은데 1회 평균이 1.460ms → 0.904ms로 **38.1% 줄었다.** `Tracking.update`는 1회 0.0652ms → 0.0249ms로 61.9%, `Detection`은 0.199ms → 0.145ms로 26.8% 줄었다. 다만 이들의 절대 크기는 프레임당 합계 1.1ms 수준이라 CPU 총량에 미치는 영향은 작다.

## Operation 실행 횟수와 1회당 시간

| Operation | before 횟수 | improved 횟수 | 횟수 차이 | before 1회 | improved 1회 | 1회 차이 |
|---|---:|---:|---:|---:|---:|---:|
| `FrameImageProxy` | 296 | 297 | **동일** | 1.460ms | 0.904ms | **-38.1%** |
| `Detection` | 148 | 148 | **동일** | 0.199ms | 0.145ms | -26.8% |
| `Preprocessor` | 148 | 148 | **동일** | 0.0152ms | 0.0088ms | -42.0% |
| `Tracking.update` | 147 | 107 | -27.2% | 0.0652ms | 0.0249ms | **-61.9%** |
| `YOLO.run` | 73 | 56 | **-23.3%** | 129.43ms | 128.05ms | **-1.1%** |
| `YOLO.preprocess` | 73 | 56 | -23.3% | 0.548ms | 1.336ms | **+143.9%** |
| `YOLO.readOutput` | 73 | 56 | -23.3% | 0.122ms | 0.0988ms | -19.2% |
| `YOLO.postprocess` | 73 | 56 | -23.3% | 0.225ms | 0.223ms | -1.2% |

`FrameImageProxy`·`Detection`·`Preprocessor`는 횟수가 같아 1회당 비교가 그대로 성립한다. `YOLO.*`와 `Tracking.update`는 횟수가 달라졌으므로 총합이 아니라 1회당 값으로 읽어야 한다.

## FrameImageProxy — 유일한 명확한 per-frame 개선

| 항목 | before | improved | 차이 |
|---|---:|---:|---:|
| 실행 횟수 | 296 | 297 | 동일 |
| 시작 간격 median | 33.21ms | 32.81ms | 동일 (약 30fps) |
| duration median | 1.124ms | 0.697ms | **-38.0%** |
| duration 평균 | 1.460ms | 0.904ms | -38.1% |
| duration p90 | 3.053ms | 1.679ms | **-45.0%** |
| duration p99 | 6.094ms | 5.743ms | -5.8% |
| duration max | 10.459ms | 8.108ms | -22.5% |
| 누적 | 432.2ms | 268.5ms | -37.9% |

중앙 1초(+4.5~5.5초)에서도 30회 · 1.367ms → 30회 · 0.726ms로 **-46.9%**, 최대값은 4.317ms → 1.679ms다. 구간을 바꿔도 같은 방향이다.

꼬리는 거의 안 줄었다(p99 -5.8%). 평균·median·p90은 크게 줄었지만 드물게 나오는 5ms 이상 프레임은 남아 있다.

## YOLO — 1회 비용은 그대로, 실행률이 떨어졌다

| 항목 | before | improved | 차이 |
|---|---:|---:|---:|
| `YOLO.run` 횟수 | 73 | 56 | -23.3% |
| 초당 실행 | 7.3회 | 5.6회 | -23.3% |
| 1회 wall duration 평균 | 129.43ms | 128.05ms | -1.1% |
| 1회 wall min / max | 126.1 / 152.3ms | 129.9 / 145.9ms | — |
| 시작 간격 median | 133.1ms | 195.9ms | **+47.2%** |
| 종료 → 다음 시작 gap median | 1.4ms | **60.0ms** | +58.6ms |
| 추론 점유율(wall 합 / 캡처 길이) | 94.3% | 71.5% | -22.8%p |
| 추론 1회당 CPU | 139.8 CPU ms | 138.7 CPU ms | -0.8% |

### 스레드 배치

| | before | improved |
|---|---|---|
| 실행 스레드 | `DefaultDispatch` 73회 | `ML-Inference-0` 28회 · `ML-Inference-1` 28회 |
| 두 실행의 시간 중첩 | — | **0ms** |

improved는 스레드를 두 개 쓰지만 **두 `YOLO.run`이 단 1ms도 겹치지 않는다.** 병렬 실행이 아니라 교대 실행이다. 그래서 스레드를 늘렸는데도 처리량은 늘지 않고, 오히려 매 추론 사이에 median 60ms의 유휴 구간이 새로 생겼다.

before는 gap median 1.4ms로 사실상 연속 실행(포화) 상태였다. improved의 60ms gap이 의도한 frame skip 정책인지, 아니면 파이프라인이 프레임 공급을 기다린 것인지는 trace만으로 구분할 수 없다.

### 하위 단계

`YOLO.run` 128ms이 추론 전체 비용의 98.5%다. `preprocess`가 1회 0.548 → 1.336ms로 2.4배 비싸졌지만 절대값이 1.3ms라 총 비용에는 거의 영향이 없다. 이 증가는 CameraX가 하던 YUV→RGB 변환(`libimage_processing_util_jni.so`, `CameraX-camerax` 스레드 CPU 441.3 → 100.1ms)이 앱 안 NV21 패키징으로 옮겨온 결과로 보인다. 옮긴 쪽이 -341ms, 늘어난 쪽이 +35ms이므로 이동 자체는 이득이다.

## 초 단위

| 초 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `FrameImageProxy` before 횟수 | 27 | 31 | 29 | 30 | 30 | 31 | 29 | 31 | 29 | 29 |
| `FrameImageProxy` improved 횟수 | 27 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| `FrameImageProxy` before 평균 | 1.176 | 1.777 | 1.752 | 1.150 | 1.549 | 1.296 | 1.478 | 1.430 | 1.435 | 1.538 |
| `FrameImageProxy` improved 평균 | 1.367 | 0.762 | 0.772 | 0.784 | 0.805 | 1.150 | 0.898 | 0.731 | 1.079 | 0.737 |
| `YOLO.run` before 횟수 | 7 | 7 | 8 | 7 | 8 | 7 | 8 | 7 | 8 | 6 |
| `YOLO.run` improved 횟수 | 5 | 5 | 6 | 5 | 6 | 6 | 5 | 6 | 6 | 6 |
| `Tracking.update` before 횟수 | 14 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 13 |
| `Tracking.update` improved 횟수 | 8 | 10 | 11 | 11 | 10 | 11 | 10 | 12 | 12 | 12 |

`FrameImageProxy` 개선은 1초를 뺀 전 구간에서 일관된다(0초만 1.176 → 1.367ms로 역전). `YOLO.run` 감소도 전 구간에서 일정하며 특정 구간의 일시적 현상이 아니다.

## 우선 조치

1. **`YOLO.run` 실행률 73 → 56회가 의도한 변경인지 먼저 확인한다.** 의도했다면 CPU 개선의 대부분이 이 정책 변경의 결과이므로 그렇게 보고해야 하고, 의도하지 않았다면 프레임 공급 회귀다.
2. `ML-Inference-0/1` 두 스레드가 전혀 겹치지 않는다. 파이프라인이 직렬이면 스레드를 둘 둘 이유가 없고, 병렬 처리 의도였다면 동작하지 않고 있다. 둘 중 무엇인지 정한다.
3. 추론 사이 60ms 유휴 구간이 frame skip 정책인지 확인한다. 겹쳐 실행하거나 gap을 줄이면 같은 CPU로 실행률을 되돌릴 수 있다.
4. `FrameImageProxy` p99(6.09 → 5.74ms)는 거의 그대로다. 평균은 좋아졌으니 다음은 꼬리를 본다.
5. `YOLO.run` 128ms 안쪽에는 marker가 없다. 추론 비용의 98.5%가 이 블록 하나이므로, 실제 최적화 대상을 찾으려면 delegate·모델 실행 내부에 marker를 더 넣거나 LiteRT profiler를 붙여야 한다.

## 측정 한계

- `YOLO.run` duration은 wall 시간이다. 해당 스레드가 그동안 계속 on-CPU였는지는 `sched` 기준으로 별도 확인이 필요하다. 다만 `ML-Inference-0/1`의 CPU 시간 합(7,467ms)이 `YOLO.run` wall 합(7,171ms)과 근접하므로 대부분 실제 실행으로 보인다.
- `YOLO.run` 표본에 `dur = -1e-6ms`인 항목이 각 1건 있다(캡처 종료 시점의 미종료 slice). 평균 계산에 포함돼 있고 영향은 무시할 수준이다.
- 두 캡처는 서로 다른 프로세스 실행이라 JIT 상태와 DVFS 이력이 다르다. CPU 7 평균 주파수는 improved가 1,837MHz로 before(1,946MHz)보다 낮았다.
- `Detection`(평균 0.15~0.20ms)은 추론 구간이 아니라 결과 dispatch 구간이다. 추론 횟수의 대리 지표로 쓰면 안 된다 — 실제로 `Detection`은 148회로 같은데 `YOLO.run`은 73 → 56회로 달랐다.
