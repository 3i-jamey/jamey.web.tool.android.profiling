- harness: OpenCode
- model: openai/gpt-5.6-sol (effort: high)
- 브랜치: main
- 작업일: 2026-07-26
- 근거 플랜: .aimd/21-plan/260726-01-client-only-trace-comparison.md
- 사람 개입: 포트 번호를 개발 서버 3100, 프리뷰 8100으로 지정

# 구현 식별

브라우저에서 Perfetto trace 두 개를 순차 처리하고 결정적 fact pack을 만든 뒤, 사용자가 선택한 런타임 LLM으로 해석하는 구현이다.
빌드 모델과 런타임 분석 모델은 화면 푸터 및 리포트 내보내기에 별도 라벨로 기록한다.
