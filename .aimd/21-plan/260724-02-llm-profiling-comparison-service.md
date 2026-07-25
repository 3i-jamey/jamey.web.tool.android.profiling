# LLM 프로파일링 비교 웹 서비스 계획

- 일자: 2026-07-24
- 상태: 계획 확정
- 제품 형태: ZIP 기반 프로파일링 비교 웹 서비스
- 핵심 원칙: LLM 에이전트가 도구를 사용해 수치를 직접 측정하고 비교한다.

## 1. 목표

사용자가 같은 시나리오의 변경 전·후 프로파일링 자료를 ZIP 파일로 업로드하고, 참고 사항과 분석 요청을 프롬프트로 입력하면 LLM 에이전트가 두 자료를 직접 탐색·측정해 실제 성능 개선과 회귀를 보고하는 웹 서비스를 만든다.

완료 기준:

- 기준선 ZIP과 비교 대상 ZIP을 각각 업로드할 수 있다.
- 사용자가 측정 조건, 코드 변경 내용, 관심 지표를 자유 프롬프트로 입력할 수 있다.
- LLM이 업로드된 Perfetto trace와 메타데이터를 도구로 탐색한다.
- LLM이 필요한 SQL과 계산을 스스로 결정하고 실행해 비교 수치를 만든다.
- 결과에는 개선, 회귀, 판단 보류 항목과 그 근거가 함께 표시된다.
- 모든 수치는 재현 가능한 SQL, 계산식, 원본 trace 식별자와 연결된다.
- 분석 과정과 최종 보고서를 다시 열거나 Markdown/JSON으로 내려받을 수 있다.

## 2. 제품 가정

구현 작업에 넘길 프로파일링 소스 루트는 다음 경로로 고정한다.

```text
/Users/3i-a1-2022-033/Workspaces/mobile.android.app.pivoplus/.aimd/12-wiki/02-profiling
```

이 루트를 기준으로 필요한 자산을 해석한다.

| 자산 | 경로 |
|---|---|
| 캡처 스크립트 | `script/capture-performance.sh` |
| 캡처 방법과 출력 규격 | `01-performance-profiling.md` |
| P0 검증용 기존 캡처 | `captures/` |

별도 서비스 저장소를 만들 때 구현 담당자에게 위 루트를 입력 자료로 넘긴다. 서비스 코드가 이 로컬 절대 경로에 런타임 의존하지는 않으며, 캡처 ZIP 계약과 필요한 스크립트는 서비스 저장소에 이관하거나 배포 가능한 형태로 제공한다.

MVP는 다음 입력을 기준으로 한다.

| 입력 | 내용 |
|---|---|
| 기준선 ZIP | 변경 전 특정 시간대의 프로파일링 캡처 |
| 비교 ZIP | 변경 후 같은 시나리오의 프로파일링 캡처 |
| 사용자 프롬프트 | 변경 내용, 측정 목적, 특히 확인할 경로와 해석 시 주의사항 |

현재 캡처 ZIP의 기본 구조는 다음과 같다.

```text
capture.zip
├─ config.textproto
├─ metadata.txt
└─ trace-YYYYMMDD-HHMMSS.perfetto-trace
```

ZIP 내부에 여러 trace가 있으면 MVP에서는 사용자에게 분석 대상을 선택하게 한다. 자동 다중 구간 비교는 후속 범위로 둔다.

## 3. 사용자 흐름

1. 새 비교 분석을 만든다.
2. 기준선과 비교 대상의 이름을 입력한다. 예: `NV21 초기 구현`, `PixelEngine 적용`.
3. 두 ZIP 파일을 업로드한다.
4. 참고 프롬프트를 입력한다.
5. 서버가 ZIP과 trace의 안전성 및 읽기 가능 여부만 사전 검증한다.
6. LLM 에이전트가 두 trace를 열고 필요한 측정을 계획한다.
7. 화면에서 현재 단계와 실행 중인 측정 항목을 확인한다.
8. 분석 완료 후 프롬프트 기준으로 선정된 핵심 지표 3~5개와 상세 비교를 확인한다.
9. 각 수치에서 근거 SQL, 계산식, 원시 결과를 펼쳐 볼 수 있다.
10. 다른 프롬프트로 다시 분석하거나 읽기 전용 링크로 결과를 공유한다.

프롬프트 입력 예시:

```text
NV21 Kotlin packing을 PixelEngine native 경로로 교체했습니다.
이미지 준비 CPU, FrameProcess 처리량, LiteRT 비용, UI jank와 GC를 비교해 주세요.
두 캡처의 처리 프레임 수가 다르므로 총 CPU뿐 아니라 시간과 호출 수를 정규화해 주세요.
sampling sample을 실제 wall latency로 단정하지 말아 주세요.
```

## 4. 핵심 설계

고정된 분석 엔진이 미리 정한 지표를 계산하지 않는다. LLM이 프롬프트와 trace 내용을 보고 측정 항목, SQL, 정규화 기준과 비교 방법을 결정한다.

```text
Browser
  -> Web API
     -> Upload/Job Store
     -> LLM Analysis Orchestrator
        -> Archive Tool
        -> Metadata Tool
        -> Perfetto Trace Processor Tool
        -> Calculation Tool
        -> Evidence Store
     -> Report Store
```

역할을 다음처럼 분리한다.

| 구성 요소 | 책임 |
|---|---|
| 웹 UI | ZIP 업로드, 프롬프트 입력, 진행 상태, 결과와 근거 표시 |
| API | 인증, 업로드, 작업 생성, 상태 조회, 결과 다운로드 |
| 분석 오케스트레이터 | LLM tool-calling loop, 예산과 단계 제어, 실패 복구 |
| Trace Processor 도구 | LLM이 작성한 SQL을 지정 trace에서 실행 |
| 계산 도구 | 비율, 증감률, 정규화, 통계 계산을 코드로 실행 |
| Evidence Store | SQL, 파라미터, 결과 행, 계산식, 모델 응답 기록 |
| 저장소 | 원본 ZIP, 추출 trace, 작업 상태, 최종 보고서의 수명 관리 |

LLM은 수치를 직접 측정하지만 binary trace를 토큰으로 읽지는 않는다. LLM이 Trace Processor SQL과 계산 도구를 선택·작성·호출하고 그 결과로 다음 측정을 결정하는 에이전트 방식으로 동작한다.

## 5. LLM 분석 루프

### 5.1 사전 확인

LLM은 먼저 다음을 확인한다.

- trace 유효 구간과 기록 시간
- package, PID, versionCode, 기기, Android build
- profileable/debuggable 여부
- sampling frequency와 callsite 보유율
- 데이터 손실과 파싱 오류
- 두 캡처의 조건 차이

조건이 크게 다르면 분석을 중단하지 않고 비교 가능 항목과 판단 불가 항목을 분리한다.

### 5.2 측정 계획 생성

LLM은 사용자 프롬프트를 바탕으로 분석 체크리스트를 동적으로 만든다.

예시:

- 앱 CPU 시간과 평균 사용 코어
- thread/thread group별 CPU
- 특정 함수와 callstack의 sampled CPU
- Camera callback과 `FrameProcess` 처리량
- FrameTimeline deadline miss
- GC 횟수와 span
- RSS, managed heap, GPU memory
- 변경된 처리 경로의 호출 수와 상대 비용
- 새로 부상한 병목

이 목록은 기본 템플릿일 뿐이며 실제 쿼리와 포함 여부는 LLM이 결정한다.

### 5.3 도구 실행

LLM에 다음 제한 도구만 제공한다.

| 도구 | 기능 |
|---|---|
| `list_archive_entries` | ZIP 내부 파일 목록과 크기 조회 |
| `read_text_entry` | 허용된 메타데이터 텍스트 읽기 |
| `open_trace` | trace를 격리된 Trace Processor session으로 열기 |
| `describe_trace` | 사용 가능한 table, metric, trace 범위 요약 |
| `run_trace_sql` | 지정 trace에 read-only SQL 실행 |
| `calculate` | 두 결과의 증감률, 비율, 정규화와 통계 계산 |
| `save_evidence` | 수치와 SQL·계산식·제약을 근거로 저장 |
| `finish_report` | 구조화된 최종 보고서 제출 |

LLM에 shell, 임의 파일 접근, 네트워크 접근은 제공하지 않는다.

### 5.4 교차 검증

최종 보고 전 LLM이 다음을 자체 점검하게 한다.

- 비교 수치의 분모와 단위가 같은가
- 총량 비교 시 trace 시간이나 처리 건수를 정규화했는가
- sampled CPU와 wall duration을 구분했는가
- 호출 수가 다른 데이터의 per-frame 추정치를 실제 latency로 표현하지 않았는가
- 같은 metric을 가능한 다른 SQL로 재확인했는가
- 개선된 CPU와 악화된 FPS처럼 상충하는 지표를 누락하지 않았는가
- 근거가 없는 숫자를 최종 응답에 넣지 않았는가

## 6. 결과 모델

최종 결과는 고정된 성공·실패 분류에 맞추지 않는다. LLM이 사용자 프롬프트에서 이번 비교의 판단 기준을 해석하고, 지표별 판단을 먼저 만든 뒤 해당 상황에 맞는 종합 설명을 생성한다.

서술형 응답만 저장하지 않고 다음 구조를 함께 저장한다.

```text
AnalysisReport
├─ userPrompt
├─ analysisCriteria[]
├─ environmentComparison
├─ synthesis
├─ headlineMeasurements[3..5]
├─ sections[]
│  ├─ title
│  ├─ summary
│  └─ measurementIds[]
├─ measurements[]
│  ├─ name/unit
│  ├─ baseline/candidate/delta
│  ├─ assessment
│  ├─ measurementType
│  ├─ confidence
│  └─ evidenceIds[]
├─ bottlenecks[]
├─ caveats[]
├─ recommendations[]
└─ evidence[]
   ├─ traceId
   ├─ sql
   ├─ rawResult
   ├─ calculation
   └─ interpretation
```

`measurementType`은 최소 다음을 구분한다.

| 타입 | 의미 |
|---|---|
| `DIRECT_DURATION` | trace slice 등에서 직접 측정한 wall duration |
| `SAMPLED_CPU` | linux.perf sample 기반 CPU 추정 |
| `COUNTER` | 메모리·GPU 등 counter 값 |
| `EVENT_COUNT` | 프레임·GC·호출 횟수 |
| `DERIVED` | 직접 값으로 계산한 비율이나 증감률 |
| `ESTIMATE` | sample과 처리 건수로 만든 제한적 추정치 |

`assessment`는 `IMPROVED`, `REGRESSED`, `NEUTRAL`, `INCONCLUSIVE`를 사용하되 의미와 우선순위는 고정 규칙이 아니라 사용자 프롬프트에서 도출한 `analysisCriteria`를 따른다.

`confidence`는 `HIGH`, `MEDIUM`, `LOW`로 두고 모든 수치 옆에 측정 타입과 함께 표시한다. 낮은 신뢰도만 별도 주의사항으로 보내지 않고 사용자가 수치를 읽는 순간 직접 측정인지 추정인지 알 수 있어야 한다.

## 7. 화면 구성

전체 시각 방향은 흰 배경의 절제된 일반 웹페이지다.

- 장식적인 gradient, glass effect, 큰 그림자와 과도한 카드 중첩을 사용하지 않는다.
- 섹션은 여백, 얇은 divider와 타이포그래피 크기로 구분한다.
- 본문은 가독성 높은 sans-serif, 수치·단위·SQL은 tabular number를 지원하는 monospace를 사용한다.
- 주조색은 한 가지 중립적인 blue 계열로 제한한다.
- 개선·회귀·주의 색상은 작은 delta, 상태 라벨과 차트 mark에만 사용한다.
- 핵심 정보는 색상 없이도 부호, 텍스트와 아이콘으로 구분되어야 한다.
- 모든 화면과 상세 기능을 모바일까지 완전 반응형으로 제공한다.

### 7.1 새 분석

- 서비스 첫 진입 화면 자체를 새 분석 화면으로 사용
- 기준선 ZIP drop zone
- 비교 ZIP drop zone
- 각 캡처 이름 입력
- 분석 맥락과 판단 기준을 적는 큰 자유 프롬프트 textarea
- 프롬프트 suggestion chip이나 구조화 질문 폼은 제공하지 않음
- package, 관심 시간 범위, 분석 예산은 접힌 세부 설정으로 배치
- 분석 시작 버튼

### 7.2 분석 진행

- 업로드와 trace 검증 상태
- LLM이 만든 측정 계획
- 실시간 도구 실행 로그
- 각 로그의 trace, 도구 이름, 실행 상태, 소요 시간과 결과 행 수
- 펼쳤을 때 보이는 SQL, 계산식과 제한된 원시 결과
- 완료된 측정 수와 남은 도구 호출 예산
- 취소 버튼

실시간 로그는 흰 배경의 세로 event stream으로 구성한다. 성공, 실행 중, 실패 상태는 작은 상태 mark와 timestamp로 구분하고 터미널을 그대로 흉내 내지 않는다.

LLM의 내부 chain-of-thought는 노출하지 않고 측정 계획, 도구 호출 이름, SQL, 계산식과 도구 결과만 표시한다.

### 7.3 결과

결과는 일반적인 KPI 카드 대시보드나 긴 LLM 보고서가 아니라 `얼마나 개선됐는가`를 먼저 답하는 비교 캔버스로 구성한다.

1. 상단에 기준선, 비교 대상과 사용자의 원래 프롬프트를 짧게 표시한다.
2. LLM이 프롬프트 기준으로 선정한 핵심 지표 3~5개를 가장 먼저 보여준다.
3. 각 핵심 지표는 `Before -> delta -> After`를 한 행에 배치한다.
4. 지표별 개선·회귀·중립·판단 보류와 측정 타입·신뢰도를 항상 함께 표시한다.
5. 핵심 지표 아래에는 같은 열 구조를 유지한 비교 캔버스에서 CPU, 처리량, UI, GC, memory, 병목 등 LLM이 발견한 섹션을 동적으로 구성한다.
6. 차트는 시간축이나 분포가 해석에 실제로 필요한 항목에만 사용한다. 단순 before/after 값은 숫자와 절제된 delta bar로 표현한다.
7. 전체 종합은 고정 점수나 보편적인 성공 기준을 사용하지 않고 프롬프트의 목적과 지표별 판정을 근거로 작성한다.
8. 수치의 `근거 보기`를 누르면 우측 또는 하단 drawer에서 SQL, 계산식과 원시 결과를 확인한다.
9. 환경 차이, 제약과 추가 측정 권고는 본문 마지막에 명확히 분리한다.
10. `다른 프롬프트로 다시 분석`은 기존 ZIP을 재사용해 새 분석 작업을 생성한다. 완성된 기존 결과는 변경하지 않는다.
11. 읽기 전용 공유 링크 생성과 Markdown/JSON 다운로드를 제공한다.

모바일에서는 핵심 지표와 비교 행을 `Before`, `After`, `delta` 순의 세로 묶음으로 바꾸고, 실시간 로그·SQL·원시 표까지 생략 없이 접근할 수 있게 한다. 가로 폭이 필요한 데이터는 잘라내지 않고 해당 영역만 수평 스크롤한다.

## 8. 권장 기술 구조

Android 앱 저장소와 배포 수명이 다르므로 실제 서비스는 별도 저장소로 시작하는 것을 권장한다.

| 영역 | MVP 권장안 |
|---|---|
| Frontend | Next.js + TypeScript |
| UI | React, server state는 TanStack Query |
| API/Agent worker | Python FastAPI |
| Trace 분석 | Perfetto Trace Processor 또는 Python API |
| 비동기 작업 | 초기에는 DB job polling, 필요 시 Redis queue로 확장 |
| DB | PostgreSQL |
| 파일 저장 | 로컬 임시 저장에서 시작, 배포 시 S3 호환 object storage |
| LLM | tool calling과 JSON schema 응답을 지원하는 provider adapter |
| 배포 | Web/API/worker 분리 container |

Python worker를 권장하는 이유는 Trace Processor 실행, SQL 결과 가공, 계산 sandbox와 LLM agent loop를 한 프로세스 경계에서 다루기 쉽기 때문이다.

## 9. API 초안

```text
POST   /api/analyses
POST   /api/analyses/{id}/uploads/baseline
POST   /api/analyses/{id}/uploads/candidate
POST   /api/analyses/{id}/start
GET    /api/analyses/{id}
GET    /api/analyses/{id}/events
POST   /api/analyses/{id}/cancel
POST   /api/analyses/{id}/rerun
GET    /api/analyses/{id}/report
GET    /api/analyses/{id}/report.md
GET    /api/analyses/{id}/report.json
POST   /api/analyses/{id}/share
DELETE /api/analyses/{id}/share
GET    /s/{shareToken}
```

진행 상태는 `CREATED -> UPLOADING -> VALIDATING -> ANALYZING -> VERIFYING -> COMPLETED` 순으로 두고 실패와 취소 상태를 별도로 둔다.

## 10. 보안과 운영 제약

- ZIP 경로 탈출, symlink, 중첩 archive를 거부한다.
- 압축 전·후 최대 크기, 파일 수, trace 개수 제한을 둔다.
- worker는 분석마다 격리된 임시 디렉터리와 제한된 CPU/메모리에서 실행한다.
- SQL은 Trace Processor session에만 실행하고 외부 DB에는 실행하지 않는다.
- LLM API key는 서버에만 보관한다.
- ZIP 내부 텍스트는 신뢰하지 않는 입력으로 취급해 system prompt를 변경할 수 없게 한다.
- 원본 ZIP과 trace는 기본 24시간 후 삭제하고 사용자가 즉시 삭제할 수 있게 한다.
- 보고서에 기기 serial, 사용자 경로 등 민감한 메타데이터를 기본 마스킹한다.
- 공유 URL은 최소 128bit entropy의 무작위 token을 사용하고 읽기 전용으로 제공한다.
- 공유 링크는 원본 ZIP과 trace 다운로드 권한을 포함하지 않으며 만료와 즉시 폐기를 지원한다.
- 모델명, provider, prompt version, tool call, SQL, 계산 결과를 감사 로그로 남긴다.

## 11. 비용과 실패 제어

- 분석당 최대 LLM turn, SQL 실행 수, 반환 행 수와 시간을 제한한다.
- 대형 SQL 결과는 LLM에 전체 전달하지 않고 요약 또는 제한된 행만 반환한다.
- 동일 SQL과 trace 조합은 캐시한다.
- LLM이 반복 쿼리하거나 진전이 없으면 중단하고 현재까지의 부분 결과를 제공한다.
- tool 오류는 최대 횟수만 자동 재시도하고, SQL 오류는 오류 메시지를 LLM에 돌려 수정 기회를 준다.
- 사용자가 빠른 분석과 정밀 분석 중 비용 수준을 선택할 수 있게 확장한다.

## 12. 구현 단계

### P0. 분석 에이전트 기술 검증

기존 캡처 두 개를 사용해 UI 없이 LLM tool-calling loop를 검증한다.

- 프로파일링 소스 루트에서 캡처 스크립트와 ZIP 출력 계약 확인
- 같은 루트의 `captures/`에서 기준선과 비교 대상 선정
- Trace Processor session 두 개 열기
- LLM이 프롬프트에서 측정 계획 생성
- LLM이 SQL 작성과 실행을 반복
- 계산 도구로 before/after delta 계산
- 기존 `.aimd/32-result/260723-11-nv21-before-after-comparison.md` 수준의 보고서 생성
- 모든 숫자에 evidence 연결

통과 조건:

- 기존 핵심 CPU, FPS, jank, GC 결과를 재현한다.
- sampled CPU를 실제 wall latency로 잘못 표현하지 않는다.
- 고정 metric extractor 없이 LLM이 필요한 쿼리를 선택한다.
- 동일 입력을 3회 실행했을 때 핵심 판정과 주요 수치가 일관된다.

### P1. 안전한 업로드와 작업 기반 구축

- 분석 작업 생성 API
- 두 ZIP 업로드와 archive 검증
- trace/metadata 추출과 TTL 삭제
- worker job 실행과 상태 API
- 취소와 실패 처리

통과 조건:

- 정상 캡처 ZIP은 분석 준비 상태가 된다.
- 잘못된 ZIP, zip bomb, 누락 trace는 명확한 오류로 거부된다.
- 작업 격리와 자동 삭제가 동작한다.

### P2. 분석 에이전트 제품화

- 도구 계약과 JSON schema 고정
- 분석 prompt version 관리
- 측정 계획, 교차 검증, 보고서 생성 단계 분리
- evidence 저장과 재생
- 비용과 tool-call budget 제한

통과 조건:

- 최종 보고서의 모든 수치가 evidence를 가진다.
- SQL만 다시 실행해 수치를 재현할 수 있다.
- 조건이 다른 trace는 판단 보류와 caveat를 생성한다.

### P3. 웹 UI 구현

- 첫 진입에서 바로 시작하는 분석 생성/업로드/자유 프롬프트 화면
- SQL과 도구 결과를 보여주는 실시간 실행 로그
- 핵심 지표 3~5개와 상세 비교 캔버스
- 제한적으로 사용하는 delta·시간축·분포 차트
- measurement type과 confidence의 상시 표시
- evidence drawer
- 기존 ZIP을 재사용하는 새 프롬프트 분석
- token 기반 읽기 전용 공유 링크
- Markdown/JSON 다운로드
- 전체 기능의 완전 반응형 지원

통과 조건:

- 사용자가 터미널 없이 두 ZIP의 비교를 완료한다.
- 분석 중 실행 SQL, 도구 결과와 실패 이유를 실시간으로 확인할 수 있다.
- 보고서에서 수치 근거까지 탐색할 수 있다.
- 같은 분석을 모바일에서도 생성·확인·공유할 수 있다.
- 공유 링크 보유자가 로그인 없이 읽기 전용 결과를 열 수 있다.

### P4. 운영 강화

- 선택적 인증과 사용자별 분석 이력
- object storage와 queue 도입
- rate limit, quota, 비용 대시보드
- container sandbox와 관측성
- 실제 배포 환경 부하/보안 테스트

## 13. 테스트 전략

| 범위 | 검증 |
|---|---|
| Archive | 정상 ZIP, 경로 탈출, symlink, zip bomb, 누락 파일 |
| Trace tool | session 격리, SQL timeout, 행 제한, 잘못된 SQL |
| Calculation | 증감률, 0 분모, 단위 변환, duration/frame 정규화 |
| LLM agent | tool 선택, retry, budget 종료, evidence 없는 수치 차단 |
| Report | JSON schema, measurement type, confidence, 근거 참조 무결성 |
| E2E | 두 실제 캡처 업로드부터 Markdown 다운로드까지 |
| 회귀 | 대표 캡처와 프롬프트의 기대 수치·판정 golden set |

LLM 출력의 문장 전체를 snapshot으로 고정하지 않는다. 핵심 metric 값, 단위, 판정 방향, evidence 존재 여부와 금지 표현을 회귀 기준으로 둔다.

## 14. MVP 범위 밖

- 세 개 이상의 캡처를 한 번에 비교하는 추세 분석
- Android 기기에서 직접 캡처를 시작하는 기능
- 코드 저장소나 PR diff 자동 연결
- Perfetto 외 Android Studio CPU profiler, iOS Instruments 지원
- 공유 결과의 댓글과 승인 workflow
- 모델 fine-tuning

## 15. 제품 결정

그릴 인터뷰에서 다음을 확정했다.

| 갈래 | 결정 |
|---|---|
| 1차 사용자 | 다음 최적화를 판단하는 성능 개발자 |
| 결과의 첫 질문 | 얼마나 개선됐는가 |
| 상단 요약 | LLM이 프롬프트 기준으로 고른 핵심 지표 3~5개 |
| 상세 구조 | Before·delta·After 비교 캔버스 |
| 종합 판정 | 프롬프트 기준 지표별 판단을 종합하며 고정 기준은 사용하지 않음 |
| 근거 | 기본은 접고 수치에서 필요할 때 drawer로 열기 |
| 시각 언어 | 흰 배경의 절제된 일반 웹페이지 |
| 화면 흐름 | 새 분석, 분석 진행, 결과의 단계별 전용 화면 |
| 첫 진입 | 바로 새 분석 시작 |
| 프롬프트 | 보조 chip 없는 자유 입력 |
| 진행 화면 | 실시간 도구·SQL 실행 로그 |
| 차트 | 의미가 있을 때만 제한적으로 사용 |
| 재분석 | 기존 결과를 바꾸지 않고 새 분석으로 실행 |
| 공유 | 링크 보유자가 로그인 없이 읽는 token 기반 공유 |
| 반응형 | 모바일을 포함한 전체 기능 지원 |
| 불확실성 | 측정 타입과 신뢰도를 모든 수치에 항상 표시 |

구현 착수 전에 남은 기술 결정을 확정한다.

1. 첫 LLM provider와 모델
2. 사내 전용인지 외부 사용자도 쓰는지
3. ZIP 최대 크기와 보관 시간
4. 별도 저장소 이름과 배포 환경
5. 공유 링크 기본 만료 시간

권장 기본값은 사내 전용, 분석당 ZIP 2개, 각 1GB 이하, 원본 24시간 보관, 로그인 없는 제한된 내부 배포로 시작하는 것이다.
