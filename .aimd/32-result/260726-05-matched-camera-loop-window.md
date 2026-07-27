# 1MB fact pack과 camera loop 매칭 구간 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: fact pack을 1MB까지 허용하고, 10초 전체 대신 workload가 유사한 약 0.5초 frame 처리 구간을 비교

## 계측 계약

- 기본 Perfetto slice 이름은 `CameraFrameLoop`다.
- 입력 camera frame 하나당 한 번, 최적화 전후에도 유지되는 frame 처리 바깥 경계에 기록한다.
- 동기 처리는 `Trace.beginSection/endSection`, 비동기 처리는 같은 frame cookie의 `beginAsyncSection/endAsyncSection`을 사용한다.
- marker 이름은 UI에서 변경할 수 있고, marker가 없으면 전체 trace로 대체하지 않고 오류를 표시한다.

## 구간 선택

- 분석 구간 길이는 정확히 500ms다.
- 기준선은 각 marker timestamp에서 시작하는 500ms 후보 중 loop count·median interval·p90 interval이 전체 후보의 중앙 profile에 가장 가까운 구간을 선택한다.
- 비교 캡처는 기준선 profile과 같은 세 값이 가장 가까운 구간을 선택한다.
- 동점이면 먼저 나타난 구간을 선택해 결정성을 유지한다.
- CPU 시간·slice duration·jank·perf sample 수는 유사도 계산에 사용하지 않고 선택 후 결과로만 비교한다.

## 추출 변경

- sched slice와 thread state는 500ms 경계를 가로지르는 duration을 잘라 정확히 합산한다.
- CPU frequency interval도 구간 경계로 잘라 시간가중 평균을 계산한다.
- atrace slice는 overlap 구간만 잘라 count·duration·histogram을 만든다.
- FrameTimeline, memory counter, perf sample, symbol, stack, 함수 self/inclusive 집계를 선택 구간으로 제한한다.
- fact pack에 원본 trace bounds와 선택 window start offset·marker profile·similarity score를 함께 기록한다.

## 예산

- fact pack 상한을 200,000 bytes에서 1,000,000 bytes로 변경했다.
- 영역별 기본 60 row 정책과 초과 시 단계적 축소는 유지한다.

## 검증

- 구간 선택 단위 테스트에서 대표 구간, reference cadence 매칭, marker 누락 오류를 검증했다.
- 기존 10초 예시 캡처에서는 반복되는 `traversal` slice를 테스트 marker로 사용했다.
- 브라우저에서 두 캡처 모두 500ms window, target CPU·slice·FrameTimeline·memory·perf 영역 추출을 확인했다.
- 검증 fact pack은 959,110 bytes로 1MB 제한 이내였다.

## 제한

- 기존 예시 캡처에는 `CameraFrameLoop`가 없어 `traversal`을 검증용 proxy로만 사용했다.
- 실제 camera workload 비교에는 앱에 marker를 추가해 새 캡처를 생성해야 한다.
- 1MB fact pack과 대화 전체를 후속 LLM 호출마다 다시 보내므로 provider context와 토큰 비용이 증가한다.
