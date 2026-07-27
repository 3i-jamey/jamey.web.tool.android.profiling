# 함수 CPU 중심 fact pack 기준 변경 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 배경: 전체 frame/thread 지표가 직접 제거된 NV21 처리 비용 절감을 가려 LLM이 최적화를 놓침

## 원인

- exact stack path에는 NV21 신호가 있었지만 긴 한쪽 전용 경로로만 제공돼 함수 단위 delta가 없었다.
- ART/runtime 공통 함수의 큰 절대 표본이 코드 변경으로 사라진 앱 함수보다 fact pack 예산에서 우선됐다.
- 한쪽에만 있는 표본은 반대쪽이 `null`이라 감소량과 `-100%`가 계산되지 않았다.

## 변경 기준

- callsite 전체 경로에서 함수별 self/inclusive 표본을 재집계한다.
- `perfFunctions`는 대상 package prefix 또는 APK 내부 native mapping에 속한 앱 함수만 포함한다.
- `perfFunctionsByThread`로 thread별 inclusive 표본을 별도 제공한다.
- sampling frequency가 있으면 `sampleCount / Hz * 1000`으로 캡처 구간 전체의 추정 on-CPU ms를 제공한다.
- 비교 캡처에서 동일 함수가 관측되지 않으면 관측값 0으로 비교해 delta와 `-100%`를 계산한다.
- 함수 영역의 상위 N은 큰 절대값보다 변화량을 기준으로 선정한다.
- exact stack은 경로별 sample count만 두고 중복 ratio를 제거해 함수 분석 예산을 확보한다.
- LLM은 함수 CPU 절감과 FrameTimeline·전체 thread 결과를 서로 지우지 않는 별도 축으로 해석한다.

## 실제 캡처 검증

| 함수 | 기준선 | 비교 | 변화 |
|---|---:|---:|---:|
| `Java_app_pivo_android_inference_mlkit_ImageProcessor_nativePreprocessNv21` | 914 inclusive samples · 추정 9,140 on-CPU ms | 관측 0 | -100% |
| `copyYuvPlanesToNv21` | 770 inclusive samples · 추정 7,700 on-CPU ms | 관측 0 | -100% |

- `npm run verify:samples`: 기존 CPU·frame·perf 골든과 위 함수 절감 신호 모두 통과.
- fact pack: 182,137 bytes로 200KB 제한 이내.

## 해석 제한

추정 on-CPU ms는 100Hz CPU sampling 기반 캡처 구간 누적 추정치다. wall latency, 함수 1회 실행 시간, 루프 1회당 ms가 아니며 inclusive 함수끼리는 같은 표본을 중복 포함할 수 있어 합산하지 않는다.
