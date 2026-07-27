# 폴더 맵

이 repo의 실제 폴더 구성과 역할이다. git 추적 폴더만 표기하고 200줄 이하로 유지하며, 갱신은 고쳐쓰기 우선으로 한다.

```
profiling/         안드로이드 성능 프로파일링 자산(캡처 가이드 문서 포함)
└─ script/         캡처 자동화 셸 스크립트
web/               브라우저 단독 trace 비교 분석 프론트엔드(단일 구현 트리)
├─ src/            React UI, ZIP 처리, WASM 추출 worker, 결정적 비교기, LLM adapter
├─ scripts/        실제 예시 캡처 브라우저 골든 검증
└─ vendor/         수정 금지 외부 자산
   └─ perfetto/    trace_processor WASM v50.1 + JS 바인딩(Apache-2.0)
.aimd/             AI 작업 공간(명령·참조·위키·보고·계획·런타임·결과)
```

`web/`은 구현체별 하위 폴더를 두지 않는다 — 여러 LLM 구현은 브랜치로 나누고, harness·model은 `web/IMPLEMENTATION.md`에 기록한다.
