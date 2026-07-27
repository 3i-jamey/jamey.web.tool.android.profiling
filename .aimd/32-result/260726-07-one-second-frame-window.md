# FrameTimeline 분석 구간 1000ms 변경 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: 자동 선택 분석 구간을 500ms에서 1000ms로 확대

## 변경

- 공통 분석 구간 상수를 `1,000,000,000ns`로 변경했다.
- 기준선 대표 cadence와 비교 matched cadence 모두 1000ms 후보에서 선택한다.
- FrameTimeline 부재 시 중앙 fallback도 1000ms를 사용한다.
- 화면의 선택 구간, LLM system prompt, 수집 가이드와 브라우저 검증 기준을 1000ms로 맞췄다.

## 기대 효과

- 100Hz perf sampling에서 함수별 표본 수가 500ms 대비 늘어 짧은 구간의 sampling 변동을 줄인다.
- 더 많은 camera frame을 포함해 cadence와 함수 CPU 비교의 안정성을 높인다.
- fact pack 상한은 1MB를 유지한다.

## 검증

- 단위 테스트 16개 통과.
- TypeScript 검사와 Vite 프로덕션 빌드 통과.
- 기존 10초 ZIP 두 개에서 marker 없이 actual FrameTimeline 기반 1000ms 대표/matched 구간 선택 통과.
- 생성 fact pack은 951,947 bytes로 1MB 제한 이내.
