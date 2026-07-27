# LLM Markdown 표 렌더링 결과

- 일자: 2026-07-26
- 대상: `web/` 자유 분석 리포트
- 요청: LLM Markdown 응답의 표 렌더링 지원

## 변경

- `react-markdown`에 `remark-gfm`을 연결해 GitHub Flavored Markdown 표 문법을 활성화했다.
- Markdown table을 전용 가로 스크롤 wrapper로 렌더링해 모바일에서 페이지 폭을 깨지 않게 했다.
- 표 header 배경, cell 정렬, 경계 스타일을 기존 비교 화면과 맞췄다.
- server-side React 렌더 테스트로 GFM 표가 실제 `<table>`·`<td>`로 변환되는 것을 확인했다.

## 검증

- 전체 단위 테스트 18개 통과.
- TypeScript 검사와 Vite 프로덕션 빌드 통과.
- Vite를 7.3.6, Vitest를 3.2.7로 패치해 `npm audit` 취약점 0건을 확인했다.
