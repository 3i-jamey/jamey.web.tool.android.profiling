# LoopMarker 없는 FrameTimeline 자동 구간 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: 앱 LoopMarker가 없다고 가정하고 500ms 유사 frame 구간 선택

## 변경

- `CameraFrameLoop` 입력, slice 조회, 계측 필수 조건을 제거했다.
- 대상 앱의 `actual_frame_timeline_slice` timestamp를 frame cadence의 첫 번째 소스로 사용한다.
- actual frame이 없으면 `expected_frame_timeline_slice` timestamp를 사용한다.
- FrameTimeline이 모두 없으면 각 trace의 중앙 500ms로 결정적으로 폴백한다.
- 기준선 대표 구간과 비교 matched 구간을 frame 수·median interval·p90 interval로 선택한다.
- CPU·duration·jank는 선택 점수에 포함하지 않고 선택된 구간의 결과로만 사용한다.
- fact pack과 비교 화면에 선택 source, 시작 offset, frame 수, interval, similarity score를 기록한다.
- 이전 marker 기반 fact pack은 window 계약이 달라 IndexedDB 복원과 JSON 재업로드에서 제외한다.

## 검증

- 단위 테스트에서 대표 cadence, reference 매칭, FrameTimeline 부재 시 중앙 폴백을 확인했다.
- 기존 10초 ZIP 두 개를 앱 marker 없이 그대로 브라우저에 입력했다.
- 양쪽 모두 `actual_frame_timeline` 기반 500ms window를 선택했다.
- CPU·slice·FrameTimeline·memory·perf symbol/stack/function 영역 추출이 통과했다.
- fact pack은 981,045 bytes로 1MB 제한 이내였다.
- 전체 단위 테스트 16개와 프로덕션 빌드가 통과했다.
