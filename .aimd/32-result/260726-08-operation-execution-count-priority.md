# Operation 실행 횟수 중심 fact pack 변경 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: 특정 operation이 1000ms 안에 몇 번 실행됐는지를 fact pack의 최우선 데이터로 사용

## 기준

- operation은 대상 앱의 thread/process track에 기록된 Perfetto slice 이름으로 식별한다.
- `executionCount`는 선택된 1000ms 안에서 해당 slice가 시작한 정확한 횟수다.
- 구간 전에 시작해 1000ms와 겹치기만 한 slice는 실행 횟수에 포함하지 않는다.
- 종료되지 않은 slice도 실행 횟수에는 포함하고 `incompleteCount`로 별도 표시한다.
- 일반 함수의 perf `sampleCount`는 호출 횟수로 해석하지 않는다.

## 추가 데이터

- `activeDurationNs`: 구간 안에서 시작한 operation의 누적 active duration
- `averageDurationNs`·`maximumDurationNs`와 duration 백분위
- `averageIntervalNs`·`minimumIntervalNs`·`maximumIntervalNs`: 같은 operation 시작 간격
- `firstStartOffsetNs`·`lastStartOffsetNs`: 1000ms 구간 안의 첫/마지막 시작 위치

## 비교·예산

- slices·GC·Binder 영역의 상위 N은 duration 크기가 아니라 execution count와 count 변화량으로 선정한다.
- 한쪽에서만 관측된 operation은 반대쪽 실행 횟수를 관측 0으로 두어 count delta를 계산한다.
- LLM은 operation execution count로 workload 수행량을 먼저 설명한 뒤 함수 CPU·FrameTimeline 결과를 해석한다.
- fact pack 상한은 1MB를 유지한다.

## 검증

- 단위 테스트에서 duration이 큰 1회 operation보다 실행 횟수가 많은 operation이 먼저 정렬되는 것을 확인했다.
- 기존 ZIP의 marker 없는 actual FrameTimeline 1000ms 구간에서 양쪽 operation execution count 추출을 확인했다.
- 브라우저 검증 fact pack은 977,718 bytes로 1MB 제한 이내였다.
