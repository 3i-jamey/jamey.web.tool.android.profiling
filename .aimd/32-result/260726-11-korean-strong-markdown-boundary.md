# 한글 조사 인접 Markdown 볼드 렌더링 결과

- 일자: 2026-07-26
- 대상: `web/` LLM Markdown 리포트
- 문제 예: `**1.716→0.742ms(-56.76%)**로`가 bold로 렌더되지 않음

## 원인

CommonMark delimiter 규칙에서 strong 내부가 `)` 같은 문장부호로 끝나고 닫는 `**` 바로 뒤에 한글 글자가 오면 닫는 delimiter가 right-flanking으로 판정되지 않을 수 있다.

## 변경

- 렌더 직전 `**…**`와 바로 뒤 한글 사이에 zero-width Markdown entity를 삽입해 strong 경계를 명확히 했다.
- Markdown AST 생성 후 zero-width separator를 제거해 화면과 복사 문자열에는 남지 않게 했다.
- HTML raw parsing은 활성화하지 않아 기존 보안 경계를 유지했다.

## 검증

- 예시 문자열이 `<strong>1.716→0.742ms(-56.76%)</strong>로` 렌더되는 server-side React 테스트를 추가했다.
- separator entity와 HTML comment가 결과 HTML에 노출되지 않음을 확인했다.
- 전체 테스트 19개와 프로덕션 빌드가 통과했다.
