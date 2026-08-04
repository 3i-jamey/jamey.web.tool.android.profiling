# 카메라 프레임 구간 기준 캡처 비교 (18:21:00 vs 18:21:27)

## 대상

- 기준: `profiling/captures/20260728-182100.zip`
- 비교: `profiling/captures/20260728-182127.zip`
- 공통: `SM-A566B`, Android 16, `app.pivo.android.capture.dev` versionCode 11921, **PID 28852 동일**, 10초, perf 100Hz
- 두 캡처의 trace 시작 간격은 26.6초다. 즉 **코드 A/B가 아니라 같은 프로세스 실행 중의 두 시점**이다.

## 결론

같은 workload를 같은 양으로 처리했는데(초당 detection 15회·카메라 프레임 60Hz 동일), 두 번째 캡처의 화면 표시 지연이 앞 5.5초 동안 프레임당 약 12.8ms 늘었다. 원인은 앱 CPU가 아니라 **MainActivity ViewRootImpl BLAST 큐가 버퍼 한 장 더 깊게 유지된 것**이다. 프레임률은 떨어지지 않고 latency만 늘어난 전형적인 buffer stuffing이며, 두 번째 캡처는 5.5초 지점에서 스스로 회복했다.

앱 CPU 총량은 회귀가 아니다(+4.6%, 중간 1초 구간에서는 오히려 -5.9%). 다만 `ML-Inference-0`의 **detection 1회당 CPU 비용은 48.8ms → 57.4ms로 17.5% 늘었다.** 이건 프레임 지연과 무관한 별개 축이다.

## 프레임 구간 선택

| 구간 | 기준 | 비교 |
|---|---|---|
| 자동 cadence 매칭 1000ms | +6.679초 · 60 frame · median 16.649ms | +8.976초 · 60 frame · median 16.641ms · similarity 0.0027 |
| 명시적 중앙 1000ms | +4.500 ~ +5.500초 | +4.500 ~ +5.500초 |

자동 매칭은 frame **시작 간격**만 보므로 두 캡처 모두 60Hz cadence를 만족했고, 비교 캡처의 열화 구간(0~5.5초)을 통째로 건너뛰어 회복 구간(+8.98초)을 골랐다. 프레임 **duration** 열화는 cadence로는 보이지 않는다. 아래는 두 구간을 모두 제시한다.

## 중앙 1초(+4.5~5.5초) 비교

| 항목 | 18:21:00 | 18:21:27 | 차이 |
|---|---:|---:|---:|
| Actual frame 수 | 59 | 59 | 동일 |
| Actual frame 평균 duration | 7.32ms | 18.92ms (54 frame) · 5.89ms (5 frame) | +158% |
| jank 분류 | `None` 59 | `Buffer Stuffing, SurfaceFlinger Stuffing` 54 · `SurfaceFlinger Stuffing` 5 | 악화 |
| 앱 CPU 시간 | 1,554.8 CPU ms | 1,462.9 CPU ms | -5.9% |
| `ML-Inference-0` CPU | 739.4ms | 765.7ms | +3.6% |
| 앱 메인 스레드 CPU | 251.4ms | 205.2ms | -18.4% |
| `RenderThread` CPU | 149.4ms | 142.6ms | -4.6% |
| `Detection` 실행 횟수 | 15 | 15 | 동일 |
| `traversal` 실행 횟수 · 평균 | 59회 · 3.503ms | 59회 · 2.660ms | -24.1% |
| `queueBuffer` 실행 횟수 | 238 | 238 | 동일 |

**같은 일을 더 적은 CPU로 하면서 프레임 표시는 2.6배 느리다.** 앱 계산량이 아니라 표시 파이프라인 문제라는 뜻이다.

## 자동 cadence 매칭 1초 비교

| 항목 | 기준 +6.679초 | 비교 +8.976초 | 차이 |
|---|---:|---:|---:|
| Actual frame 수 | 60 | 60 | 동일 |
| 평균 duration | 6.29ms | 8.14ms | +29.4% |
| jank 분류 | `None` 60 | `SurfaceFlinger Stuffing` 60 | 악화 |
| 앱 CPU 시간 | 1,375.7 CPU ms | 1,738.7 CPU ms | +26.4% |
| `ML-Inference-0` CPU | 726.3ms | 773.8ms | +6.5% |
| 앱 메인 스레드 CPU | 190.1ms | 308.5ms | +62.2% |
| CPU 7 사용 | 490.9ms | 726.0ms | +47.9% |
| 평균 RSS | 394.5MiB | 404.7MiB | +2.6% |
| perf sample 수 (unwind error) | 141 (29, 20.6%) | 163 (41, 25.2%) | — |

이 구간의 앱 CPU +26.4%는 비교 캡처 9초대의 순간 부하(메인 스레드 309ms)를 잡은 결과이며, 중앙 1초에서는 부호가 반대다. **1초 구간 하나로 CPU 총량을 판정하면 안 된다.**

## 초 단위 구조

| 초 | 기준 frame 수 · 평균 | 기준 stuffing | 비교 frame 수 · 평균 | 비교 stuffing |
|---:|---|---:|---|---:|
| 0 | 59 · 5.55ms | 0 | 60 · 18.98ms | 60 |
| 1 | 59 · 5.61ms | 0 | 60 · 18.94ms | 60 |
| 2 | 59 · 6.50ms | 10 | 61 · 18.95ms | 61 |
| 3 | 61 · 7.23ms | 61 | 60 · 18.93ms | 60 |
| 4 | 58 · 6.10ms | 11 | 60 · 18.93ms | 60 |
| 5 | 60 · 8.12ms | 0 | 59 · 11.05ms | 24 |
| 6 | 58 · 6.13ms | 0 | 60 · 5.92ms | 0 |
| 7 | 59 · 6.23ms | 0 | 60 · 5.86ms | 0 |
| 8 | 60 · 5.75ms | 0 | 60 · 5.68ms | 0 |
| 9 | 60 · 6.11ms | 0 | 58 · 8.23ms | 0 |

비교 캡처는 0~5.5초 열화 · 5.5초 이후 회복의 2상 구조다. 전체 프레임 수는 593 대 598로 같으므로 **FPS 저하가 아니라 latency 증가**다.

## 원인: BLAST 버퍼 큐 깊이

`VRI[MainActivity]@b09e322#0(f:0,a:N)`의 `a`는 큐에 잡힌 버퍼 수다.

| 큐 깊이 | 18:21:00 | 18:21:27 |
|---|---:|---:|
| `a:1` | 292 | 0 |
| `a:2` | 243 | 275 |
| `a:3` | 53 | 318 |

비교 캡처는 `a:1`이 한 번도 없고 `a:3`이 318회다. stuffing으로 분류된 프레임 325개와 거의 일치한다. expected deadline 대비 완료 시각도 기준은 **9.7ms 여유**, 비교는 **2.9ms 초과**로, 정확히 vsync 한 칸 밀린 형태다.

표시 경로 대기도 같은 방향이다.

| 항목 | 18:21:00 | 18:21:27 |
|---|---:|---:|
| `HWC release` · `waitForever` | 3회 · 6.3ms | 318회 · 4,582.4ms (평균 14.41ms) |
| `GPU completion` · `waitForever` | 867회 · 1,327.8ms (평균 1.53ms) | 871회 · 5,466.8ms (평균 6.28ms) |
| `surfaceflinger` 프로세스 CPU | 3,866.7ms | 1,715.6ms |
| `App Deadline Missed` | 1 | 0 |

SurfaceFlinger는 CPU를 **덜** 쓰면서 프레임은 밀렸고, 앱은 deadline을 한 번도 놓치지 않았다. 앱 쪽 계산 지연이 아니라 present 큐가 깊게 유지된 상태다.

두 캡처 사이에 카메라 preview SurfaceView가 재생성됐다. 기준은 `1ec238d SurfaceView[...]@0#3`, 비교는 `62469ed SurfaceView[...]@0#5`다. 큐가 깊어진 시점과 surface 재생성이 같은 구간에 있으므로 **preview surface 재구성 직후 큐가 한 칸 깊게 시작해 약 5.5초 만에 배출된 것**으로 보인다. 다만 재생성 시각 자체는 캡처 시작 이전이라 이 인과는 확정이 아니다.

## 별개 축: 추론 CPU 비용

| 항목 | 18:21:00 | 18:21:27 | 차이 |
|---|---:|---:|---:|
| `Detection` slice 수 | 149 | 148 | 동일 |
| `ML-Inference-0` CPU 시간 | 7,273.8 CPU ms | 8,490.9 CPU ms | +16.7% |
| detection 1회당 CPU | 48.82ms | 57.37ms | +17.5% |
| Running sched slice | 419회 · 평균 17.36ms | 249회 · 평균 34.10ms | 선점 감소 |
| CPU 7 점유 비중 | 5,520.9ms (75.9%) | 7,960.2ms (93.7%) | 대코어 집중 |
| Sleep(S) 총합 | 2,302.7ms | 1,239.8ms | -46.2% |
| CPU 7 평균 주파수 | 1,557MHz (max 2,304) | 1,890MHz (max 2,496) | +21.4% |

**주파수가 더 높은데 CPU 시간도 더 썼다.** 같은 detection 횟수 기준으로 소비 사이클이 늘었다는 뜻이므로 sampling 변동으로 설명되지 않는다. perf leaf 심볼은 두 캡처 모두 `libLiteRtRuntimeCApi.so`가 지배적이다(window 기준 62 → 71 sample).

앱 전체 CPU는 14,364.8 → 15,023.0 CPU ms(+4.6%)이고, 증가분 658ms 중 1,217ms가 `ML-Inference-0`에서 나왔다. 나머지 스레드는 대부분 감소했다(`CameraX-GL Thre` 805.4 → 639.8ms, 메인 2,074.4 → 1,941.7ms, `RenderThread` 1,432.5 → 1,383.4ms).

## 메모리

| 항목 | 18:21:00 | 18:21:27 | 차이 |
|---|---:|---:|---:|
| 평균 RSS | 418.3MiB | 415.9MiB | -0.6% |
| RSS watermark | 435.7MiB | 461.5MiB | +25.8MiB |
| 평균 가상 메모리 | 24,283.7MiB | 24,891.0MiB | +607.3MiB |

RSS 자체는 평평하고 watermark만 올랐다. 같은 PID의 연속 캡처이므로 watermark 상승은 두 캡처 사이 구간의 최대치를 포함한다. 메모리는 이번 비교의 병목이 아니다.

## 우선 조치

1. preview surface를 재생성하는 경로에서 `SurfaceView`/`ViewRootImpl` 큐가 한 칸 깊게 시작하는지 확인한다. 재생성 직후 프레임의 `a:N` 값과 `HWC release`의 `waitForever`를 같은 캡처 안에서 관측하면 확정할 수 있다.
2. 열화 구간이 캡처 시작 시점에 걸려 있으므로, surface 재생성 **직전부터** 캡처를 시작해 다시 수집한다. 현재 자료로는 큐가 깊어진 순간을 볼 수 없다.
3. 추론 비용 +17.5%는 별도 이슈로 다룬다. 같은 detection 횟수에 대한 회귀이므로 model·delegate·입력 크기 변경 이력을 먼저 확인한다.
4. `Trace.beginSection/endSection`을 추론 시작/종료에 넣는다. 현재 `Detection` slice는 평균 0.16~0.22ms로 실제 추론 구간이 아니라 결과 dispatch만 감싸고 있어 1회 wall latency를 측정할 수 없다.

## 측정 한계

- 자동 cadence 매칭 구간 선택은 frame 시작 간격만 본다. duration 열화는 감지하지 못하므로 frame duration 축을 별도로 봐야 한다.
- 초 단위 CPU 집계는 sched slice를 **시작한 초**에 전부 귀속한다. `ML-Inference-0`의 slice가 최대 260ms까지 길어 초당 값이 1,000ms를 넘는 칸이 있다. 전체 합계만 정확한 값이다.
- perf sample의 unwind error 비율은 window 기준 20.6%·25.2%다. 함수별 sample 수는 방향 확인용으로만 썼다.
- `traced_perf` 자체가 10.25초·9.94초의 CPU를 썼다. 두 캡처가 비슷하므로 비교에는 영향이 적지만 절대값은 프로파일링 부하를 포함한다.
- 버퍼 큐 깊이 해석은 atrace의 `(f:0,a:N)` 표기를 큐 점유 버퍼 수로 읽은 것이다. 프레임 수와 일치하지만 플랫폼 표기 규약에 의존한 해석이다.
