# NV21 직접 경로 + 전용 추론 스레드 전후 비교 (20:45:46 vs 20:50:04)

> **정정**: 이 문서의 "추론 경로 CPU -23.9%"는 1회당 비용 감소가 아니라 `YOLO.run` 실행 횟수 감소(73 → 56회)에서 나온 값이다. 앱 계측 marker 기준 재분석은 `260728-04-operation-marker-comparison.md`가 단일 출처다.

## 대상

- 기준(before): `profiling/captures/20260728-204546-before.zip` · PID 18881
- 비교(improved): `profiling/captures/20260728-205004-improved.zip` · PID 20213
- 공통: `SM-A566B`, Android 16, `app.pivo.android.capture.dev` versionCode 11921, 10초, perf 100Hz
- **PID·APK 경로가 서로 다른 별개 실행이다.** 앞선 `182100/182127` 쌍과 달리 실제 코드 A/B다.

## 결론

**CPU는 명확히 개선됐다.** 앱 전체 CPU가 17,360 → 13,962 CPU ms로 19.6% 줄었고, 추론 경로 CPU만 보면 10,206 → 7,768 CPU ms로 23.9% 줄었다. perf leaf sample의 `libLiteRtRuntimeCApi.so` 표본도 914 → 696으로 **정확히 같은 23.9%** 감소해, 서로 독립적인 두 지표가 같은 값을 가리킨다. detection 횟수는 148회로 동일하므로 처리량을 깎아서 얻은 결과가 아니다.

**프레임 지연은 이 자료로 판정할 수 없다.** improved 캡처는 0~5.5초가 buffer stuffing 상태(프레임당 18.83ms)이고 6초 이후 정상(5.7ms)이다. 그런데 before 캡처도 0~2초·5~7초가 stuffing이고, 오늘 수집한 `182100`·`182127`에도 같은 구간이 나타난다. **캡처마다 길이가 다른 정착(settle) 구간이며 이번 변경과 연결짓기 어렵다.** 재수집이 필요하다.

## 무엇이 바뀌었나

perf stack과 slice가 가리키는 변경은 두 가지다.

| | before | improved |
|---|---|---|
| 프레임 입력 | CameraX `ImageAnalysis` — `ImageReader-1280x720f1m4` · `CustomCameraXManager.processImage` · `libimage_processing_util_jni.so` | 직접 NV21 버퍼 — `ItemTrackingPipeLine.processFrameWithNv21Buffer` · `ImageProcessor.preprocessNv21` |
| 전처리 native | `Java_..._ImageProcessor_nativePreprocessRgba8888` (`libimage_processor.so`) | `PixelEngine::packageYuv420888ToNv21` · `PixelEngine::convertNv21RGBFloat` (`libpixel.so`) |
| 추론 실행 스레드 | `DefaultDispatch` 코루틴 풀 (perf 1,015 sample) | `ML-Inference-0/1` 전용 executor (perf 751 sample) |

1초 window에서 `ImageReader-1280x720f1m4-18881-9` slice 120회 · `lock` 60회가 improved에서 0회다. ImageAnalysis 스트림 자체가 사라졌다.

## CPU

| 항목 | before | improved | 차이 |
|---|---:|---:|---:|
| 앱 전체 CPU | 17,360.1 CPU ms | 13,962.5 CPU ms | **-19.6%** |
| 추론 경로 CPU 합계 | 10,205.9 CPU ms | 7,768.0 CPU ms | **-23.9%** |
| └ `DefaultDispatch` | 9,678.1 | 301.1 | -96.9% |
| └ `ML-Inference-0` | 248.6 | 3,881.8 | 이동 |
| └ `ML-Inference-1` | 279.2 | 3,585.1 | 이동 |
| `CameraX-camerax` | 441.3 | 100.1 | -77.3% |
| 앱 메인 스레드 | 2,131.8 | 1,892.3 | -11.2% |
| `CameraX-GL Thre` | 699.1 | 667.4 | -4.5% |
| `RenderThread` | 1,373.2 | 1,377.4 | 동일 |
| CPU 7 사용 | 8,291.8 | 5,620.5 | **-32.2%** |
| `queueBuffer` 실행 횟수 | 2,956 | 2,376 | -19.6% |
| `acquireBuffer` 실행 횟수 | 2,366 | 1,782 | -24.7% |
| `Detection` 실행 횟수 | 148 | 148 | 동일 |

`queueBuffer` 580회 감소는 10초 기준 약 58회/초로, 60fps 스트림 하나가 없어진 양과 맞는다. ImageAnalysis 제거의 직접 효과다.

### 구간별 재확인

CPU 개선은 어느 구간을 잘라도 같은 방향이다.

| 구간 | before | improved | 차이 |
|---|---:|---:|---:|
| 전체 10초 | 17,360.1 ms | 13,962.5 ms | -19.6% |
| 자동 cadence 매칭 1초 (+4.763초 / +7.009초) | 1,755.5 ms | 1,425.8 ms | -18.8% |
| 명시적 중앙 1초 (+4.5~5.5초) | 1,714.5 ms | 1,450.9 ms | -15.4% |

중앙 1초의 추론 스레드만 보면 `DefaultDispatch` 1,010.0ms → `ML-Inference-0/1` 758.7ms로 24.9% 감소다.

### perf 표본 교차 확인

| 항목 | before | improved | 차이 |
|---|---:|---:|---:|
| `libLiteRtRuntimeCApi.so` leaf sample | 914 | 696 | -23.9% |
| 추론 스레드 perf sample 합계 | 1,069 | 776 | -27.4% |
| `__memcpy_aarch64_simd` | 48 | 36 | -25.0% |
| `libimage_processing_util_jni.so` | 20 | 0 | -100% |
| `nativePreprocessRgba8888` | 18 | 0 | -100% |

CPU 시간(-23.9%)과 perf 표본(-23.9%)이 독립적으로 같은 값을 준다. sampling 변동으로 설명되지 않는 실제 감소다.

## 메모리

| 항목 | before | improved | 차이 |
|---|---:|---:|---:|
| HWUI All Memory 평균 | 17.08MiB | 6.11MiB | **-64.3%** |
| HWUI Misc Memory 평균 | 16.50MiB | 5.54MiB | -66.4% |
| Purgeable HWUI Misc | 13.84MiB | 2.89MiB | -79.1% |
| GPU Memory | 54.96MiB | 20.76MiB | **-62.2%** |
| 평균 RSS | 427.7MiB | 430.4MiB | +0.6% |
| RSS watermark | 450.1MiB | 462.2MiB | +12.1MiB |
| 평균 가상 메모리 | 23,383.7MiB | 23,727.1MiB | +343.4MiB |

HWUI 최대값은 before가 35.10MiB까지 튀었고(590 sample) improved는 6.95MiB에 머문다. RSS 총량은 거의 그대로다.

## 프레임 — 판정 보류

| 항목 | before | improved |
|---|---:|---:|
| Actual frame 수 | 594 | 599 |
| 가중 평균 duration | 10.34ms | 13.66ms |
| `Buffer Stuffing` | 336 (평균 10.69ms) | 0 |
| `Buffer Stuffing, SurfaceFlinger Stuffing` | 74 (평균 18.81ms) | 363 (평균 18.83ms) |
| `SurfaceFlinger Stuffing` | 153 (평균 6.12ms) | 86 (평균 5.77ms) |
| `None` | 29 (평균 7.28ms) | 146 (평균 5.66ms) |
| `App Deadline Missed` | 0 | 0 |

초 단위로 보면 두 캡처 모두 "stuffing 구간 → 정상 구간" 구조이고 구간 길이만 다르다.

| 초 | before 평균 duration · stuffing | improved 평균 duration · stuffing |
|---:|---|---|
| 0 | 18.46ms · 60 | 18.77ms · 61 |
| 1 | 18.37ms · 60 | 18.85ms · 60 |
| 2 | 7.03ms · 59 | 18.90ms · 60 |
| 3 | 6.26ms · 60 | 18.78ms · 60 |
| 4 | 6.10ms · 60 | 18.82ms · 60 |
| 5 | 10.74ms · 59 | 18.89ms · 60 |
| 6 | 13.96ms · 36 | 6.13ms · 2 |
| 7 | 9.53ms · 17 | 5.78ms · 0 |
| 8 | 6.03ms · 0 | 5.69ms · 0 |
| 9 | 6.82ms · 0 | 5.65ms · 0 |

improved의 안정 구간(6~9초) 프레임은 before의 안정 구간(8~9초)보다 오히려 빠르다(5.65~6.13ms 대 6.03~6.82ms). 자동 cadence 매칭 window는 양쪽의 서로 다른 위상을 잡아 improved가 5.75ms · before가 7.65ms로 나오고, 명시적 중앙 1초는 반대로 improved 18.91ms · before 6.06ms로 나온다. **window 하나로 프레임 지연을 판정하면 부호가 뒤집힌다.**

`VRI[MainActivity]` BLAST 큐 깊이도 양쪽 모두 깊다.

| 큐 깊이 | before | improved |
|---|---:|---:|
| `a:1` | 30 | 144 |
| `a:2` | 311 | 92 |
| `a:3` | 249 | 358 |

`HWC release`의 `waitForever`는 200회·1,831ms → 358회·4,987ms다. 같은 stuffing 패턴이 오늘 수집한 `182127`(코드 변경 없음)에도 그대로 나타났으므로 **이번 변경의 결과로 볼 근거가 없다.**

## 우선 조치

1. CPU·메모리 개선은 확정으로 취급한다. 추론 경로 -23.9%, HWUI -64%, GPU 메모리 -62%가 서로 다른 지표에서 일관되게 나온다.
2. 프레임 지연은 재수집으로 다시 판정한다. **앱 실행 후 화면이 안정된 뒤 캡처를 시작**하고, 가능하면 같은 조건으로 각 3회씩 수집해 stuffing 구간 길이의 분산을 본다. 현재는 캡처 시작 위치가 정착 구간에 걸려 있다.
3. stuffing 구간 자체를 별도 이슈로 뗀다. 4개 캡처 전부에서 관측됐고 `HWC release` 대기 증가와 큐 깊이 `a:3` 고착이 공통이다.
4. `Detection` slice는 평균 0.15~0.20ms로 실제 추론 구간이 아니다. 추론 시작/종료에 `Trace.beginSection/endSection`을 넣으면 1회 wall latency와 p90을 직접 비교할 수 있다. 현재는 CPU 시간으로만 판정 중이다.

## 측정 한계

- perf sample unwind error 비율은 before 29.1%, improved 29.8%다. 함수별 표본은 방향 확인용이며, CPU 시간(`sched_slice`)이 정량 근거다.
- `traced_perf` 자체가 10.52초·8.89초의 CPU를 썼다. improved에서 1.6초 적게 썼으므로 앱 CPU 감소분(3.4초) 전부가 프로파일러 부하 차이는 아니지만, 절대값에는 프로파일링 부하가 섞여 있다.
- 두 캡처는 서로 다른 프로세스 실행이므로 JIT 상태·캐시 온도·DVFS 이력이 다르다. CPU 7 평균 주파수는 1,946MHz → 1,837MHz로 improved가 오히려 낮았고, 이는 CPU 감소를 과소평가하는 방향이다.
- 버퍼 큐 깊이 해석은 atrace `(f:0,a:N)` 표기를 큐 점유 버퍼 수로 읽은 것이다.
