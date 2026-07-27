# 브라우저 단독 Trace 비교 분석 도구 구현 결과

- 일자: 2026-07-26
- 근거 계획: `.aimd/21-plan/260726-01-client-only-trace-comparison.md`
- 구현 위치: `web/`
- 개발/프리뷰 포트: `3100` / `8100`

## 결과

- React + Vite 정적 프론트엔드에서 ZIP 두 개를 브라우저 안에서 해제한다.
- Perfetto WASM worker를 캡처별로 하나씩 생성·종료해 17개 고정 쿼리로 facts를 추출한다.
- 순수 TypeScript 비교기가 이름별 짝지음, delta, 정규화, 한쪽 전용 항목, 환경 차이와 200KB 예산을 결정적으로 만든다.
- OpenAI Responses API와 OpenRouter Chat Completions API의 SSE adapter, 자유 마크다운 분석, `[[key]]` 인용 검증을 구현했다.
- fact pack IndexedDB 캐시, JSON 재업로드, report Markdown/JSON 및 fact pack JSON 내보내기를 구현했다.
- API key는 React 세션 상태에만 두고 영구 저장하지 않는다. trace 원본과 원시 metadata/config는 fact pack에서 제외한다.

## 검증

- `npm test`: 4개 파일, 8개 단위 테스트 통과.
- `npm run build`: TypeScript 검사와 Vite 프로덕션 빌드 통과.
- `npm run verify:samples`: Chrome에서 41~44MB 예시 ZIP 두 개를 순차 처리해 13개 데이터 영역 가용성과 계획 부록 C의 구간 길이, CPU, traversal, FrameTimeline, perf sample 골든 값을 확인했다.
- 생성 fact pack: 142,884 bytes로 200KB 제한 이내.

## 미검증

- 유효한 사용자 API key가 없으므로 OpenAI/OpenRouter의 실제 모델 응답 스트리밍 품질은 실행하지 않았다.
- Safari, 모바일 Chrome 실기와 100MB 이상 trace 임계는 계획의 후속 검증으로 남는다.
