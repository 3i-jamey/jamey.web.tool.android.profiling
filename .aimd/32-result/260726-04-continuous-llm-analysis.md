# 연속 LLM 분석 대화 개선 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: 첫 LLM 분석 이후 같은 fact pack을 바탕으로 후속 질문을 계속하고, turn마다 Terra/Sol 및 reasoning을 변경

## 변경

- 단일 `report`를 질문·응답·상태·provider·model·reasoning을 가진 turn 목록으로 교체했다.
- 첫 요청에는 fact pack을 포함하고, 후속 요청에는 첫 fact pack과 이전 사용자·assistant 메시지를 순서대로 다시 전달한다.
- 첫 응답만 `핵심 발견`·`측정 불가` 골격을 요구하고 후속 응답은 질문에 직접 답하도록 system prompt를 분리했다.
- OpenAI/OpenRouter 요청 모두 동일한 대화 메시지 배열을 사용한다.
- Model을 명시적 selector로 바꿔 `gpt-5.6-terra`·`gpt-5.6-sol`을 turn 사이에 전환할 수 있다.
- Reasoning effort도 각 후속 질문 전에 `low`·`medium`·`high`로 변경할 수 있다.
- 생성 중단 시 이미 받은 텍스트는 `interrupted` turn으로 보존한다.
- `새 분석 대화`는 fact pack을 유지하고 대화만 초기화한다.
- Markdown·JSON 내보내기에 전체 대화와 turn별 모델 설정을 기록한다.
- 후속 호출마다 fact pack과 전체 대화를 재전송해 토큰 사용량이 증가한다는 안내를 추가했다.

## 검증

- provider 단위 테스트에서 메시지 순서 `system → user → assistant → user`, fact pack 1회 포함, 현재 모델·reasoning 적용, API key 미직렬화를 확인했다.
- 내보내기 단위 테스트에서 Terra와 Sol을 사용한 두 turn의 질문·응답·설정 보존을 확인했다.
- 브라우저 샘플 검증에서 `gpt-5.6-sol`과 reasoning `medium` 선택 전환 및 기존 ZIP 골든을 확인했다.
- 유효한 API key가 없어 실제 provider에서 두 turn을 연속 생성하는 네트워크 검증은 수행하지 않았다.
