# 브라우저 단독 Trace 비교 분석 도구 계획

- 일자: 2026-07-26
- 상태: 계획 확정 · **P0 기술 검증 완료** (9.1~9.3, 부록 A~D)
- 대체 대상: `260724-02-llm-profiling-comparison-service.md` (서버·Python·에이전트 SQL 루프 전제)
- 제품 형태: 서버 없이 정적 호스팅되는 단일 프론트엔드 (TypeScript)
- 핵심 원칙: **수치는 코드가 결정적으로 뽑고, 해석은 LLM이 자유롭게 한다.**

## 1. 왜 다시 짜는가

이전 플랜은 LLM이 도구를 들고 SQL을 직접 쓰며 측정을 반복하는 에이전트 서비스였다. 실제로 만들어 본 결과 두 가지가 어긋났다.

**첫째, 자유로운 분석을 기대했는데 오히려 정형화됐다.** 원인은 LLM에게 준 자유의 위치가 틀렸기 때문이다. LLM에게 "무엇을 측정할지"를 맡기려면 측정 어휘(도구 계약, `measurementType`, `assessment`, `confidence`, 보고서 스키마)를 먼저 고정해야 했고, 그 어휘가 곧 분석의 틀이 됐다. LLM은 정해진 칸을 채우는 역할로 수렴했다.

**둘째, LLM이 쓴 SQL이 깨졌다.**

```text
run_trace_sql
{"error":"Trace Processor SQL failed: ... RE table_name IN ('cpu_profile_stack_sample',
'perf_sample','stack_profile_callsite','stack_profile_frame') ORDER BY table_name, cid
                                                                                   ^
no such column: cid"}
```

LLM이 스키마를 모르는 상태에서 스키마 introspection 쿼리를 추측해 만들다 실패했다. 이건 프롬프트를 고쳐서 줄일 수 있을 뿐 없앨 수 없는 종류의 실패다. LLM에게 SQL 작성 권한이 있는 한 남는다.

그래서 역할을 뒤집는다.

| | 이전 플랜 | 이 플랜 |
|---|---|---|
| 측정 | LLM이 SQL을 작성해 실행 | 코드가 고정 쿼리로 추출 (검증된 것만) |
| 비교 | LLM이 계산 도구 호출 | 코드가 기계적으로 짝지어 delta 계산 |
| 해석 | 고정 스키마의 칸 채우기 | LLM이 전부 자유 서술 |
| 실행 위치 | 브라우저 + FastAPI + Python worker + DB | 브라우저 하나 |
| SQL 오류 | 재시도로 완화 | 구조적으로 발생 불가 |

LLM의 자유를 **측정 단계에서 빼서 해석 단계로 옮긴다.** 측정은 재현 가능해야 하고 해석은 자유로워야 하는데, 이전 플랜은 정확히 반대로 배치돼 있었다.

## 2. 목표

같은 시나리오의 변경 전·후 Perfetto 캡처 ZIP 두 개를 브라우저에 넣으면, 페이지가 두 파일의 내용을 직접 뜯어 비교표를 만들고, LLM이 그 비교표를 읽고 자유롭게 분석을 써 주는 정적 웹 도구를 만든다.

완료 기준:

- 서버·백엔드·Python 없이 정적 호스팅(또는 로컬 `vite preview`)만으로 전 기능이 동작한다.
- 기준선 ZIP과 비교 ZIP을 넣으면 사용자가 SQL·터미널을 보지 않고 비교 분석을 받는다.
- 두 캡처에서 뽑은 모든 수치는 코드가 만든 것이며, 같은 입력에 대해 항상 같다.
- LLM은 어떤 지표가 중요한지, 어떻게 판정할지, 어떤 순서로 쓸지를 스스로 정한다.
- 리포트의 모든 인용 수치는 fact pack의 실제 항목과 연결되고, 연결되지 않는 인용은 화면에서 표시된다.
- 데이터 소스가 빠진 캡처(FrameTimeline 없음, `linux.perf` 없음 등)도 거부하지 않고 해당 영역만 `없음`으로 남긴다.

## 3. 비기능 제약

| 제약 | 내용 |
|---|---|
| 서버 없음 | 업로드·작업 큐·DB·공유 토큰 백엔드를 두지 않는다. 정적 자산만 배포한다. |
| Python 없음 | 빌드·런타임 어디에도 Python을 두지 않는다. |
| 파일 유출 없음 | trace 원본은 브라우저 밖으로 나가지 않는다. 네트워크로 나가는 것은 LLM API로 보내는 fact pack 텍스트뿐이다. |
| BYO key | 사용자가 페이지에서 API 키를 등록한다. 세션 메모리에만 두고 localStorage·cookie에 쓰지 않는다. |
| 입력 크기 | 예시 캡처 기준 trace 41~44MB. 100MB급까지 브라우저에서 견뎌야 한다. |

## 4. 처리 흐름

```text
Browser (정적 페이지, 서버 없음)
  1. ZIP 2개 선택
       ↓  zip.js (Web Worker)
  2. trace 후보 추출 · config.textproto · metadata.txt 읽기
       ↓  trace_processor WASM (Web Worker, 순차 실행)
  3. 캡처 A → 고정 쿼리 세트 → factsA        (worker 종료로 메모리 회수)
     캡처 B → 고정 쿼리 세트 → factsB        (worker 종료로 메모리 회수)
       ↓  TS 비교기 (순수 함수)
  4. factsA × factsB → factPack (짝지음 · delta · 정규화 · 한쪽에만 있는 항목)
       ↓  fetch (BYO key)
  5. factPack + 사용자 프롬프트 → LLM 1회 호출 (스트리밍)
       ↓
  6. 자유 서술 리포트 렌더 + 인용 검증 + 다운로드
```

두 trace를 동시에 열지 않는다. 44MB trace를 trace_processor가 파싱하면 실제 메모리는 그 몇 배가 되므로, **A를 열어 facts만 남기고 worker를 종료한 뒤 B를 연다.** facts는 수십 KB 규모라 둘 다 들고 있어도 부담이 없다. 이게 "두 파일을 비교해서 내용을 분석한다"의 구현 형태이기도 하다.

## 5. 1단계 — 사실 추출 (코드가 한다)

### 5.1 원칙

- 쿼리는 **우리가 작성하고 예시 캡처로 검증한 고정 목록**이다. LLM은 이 단계에 관여하지 않는다.
- 쿼리는 "중요한 지표"를 고르지 않는다. **넓게 훑는다.** 무엇이 중요한지는 뒤에서 LLM이 정한다.
- 없는 데이터 소스는 오류가 아니라 `available: false`다.
- 상위 N개로 자르는 곳에서는 잘린 개수와 잘린 합계를 함께 남긴다. 조용히 자르지 않는다.
- ZIP 안의 trace 후보는 **확장자로 거르고 내용으로 확인한다.** `.perfetto-trace`·`.pftrace`·`.trace`·확장자 없는 큰 파일을 후보로 잡되, 최종 판단은 trace_processor가 열어 보고 하게 한다. 파일명 규약에 의존하지 않는다.

### 5.2 추출 목록 (예시 캡처 2개로 검증 완료 — 컬럼은 부록 A)

| 영역 | 소스 테이블 | 뽑는 것 |
|---|---|---|
| 캡처 정체 | `trace_bounds` · `metadata` · `package_list` | 구간 길이, android build, package, versionCode |
| 신뢰도 | `stats` (`value != 0`) | 데이터 손실, buffer overrun, 파싱 오류 |
| 프로세스·스레드 | `process` · `thread` | 대상 앱 upid/pid, 스레드 목록과 이름 |
| CPU 시간 | `sched_slice` ⋈ `thread` | 프로세스별·스레드별 on-CPU 합, cpu별 분포 |
| 스레드 상태 | `thread_state` | Running/Runnable/Sleeping/D-state 비율 |
| CPU 주파수 | `counter` ⋈ `cpu_counter_track` | cpu별 시간가중 평균 주파수, idle 비율 |
| atrace 구간 | `slice` ⋈ `thread_track`/`process_track` | 이름별 count·sum·avg·max + 로그버킷 히스토그램 |
| 프레임 | `actual_frame_timeline_slice` · `expected_frame_timeline_slice` | 프레임 수, jank_type별 분포, deadline miss, present 지연 |
| 메모리 | `process_counter_track` (`mem.rss*`, `mem.swap`, GPU) | 시작·끝·평균·최대 |
| GC | `slice` (dalvik atrace) | GC 구간 수와 총 시간, 스레드 귀속 |
| Binder | `slice` (`binder transaction`) | 호출 수, 총 시간, 상대 |
| 샘플 CPU | `perf_sample` ⋈ `stack_profile_callsite` ⋈ `stack_profile_frame` ⋈ `stack_profile_mapping` | 프레임별 self/total 샘플 수, 스레드별 샘플 수, unwind 실패율, 상위 스택 경로 |

백분위는 SQL에서 계산하지 않는다. **로그 스케일 버킷 히스토그램을 SQL로 뽑고 백분위는 TS에서 보간**한다. 원시 duration 행을 대량으로 끌어오지 않기 위해서이고, 실제로 trace_processor의 SQLite에는 `LOG2`조차 없다(부록 B).

`perf_sample`은 **샘플 수**로만 다룬다. ms로 환산해 wall latency처럼 보이게 만들지 않는다. 이 구분은 프롬프트가 아니라 데이터 구조에서 강제한다 — 필드 이름 자체가 `sampleCount`이고 ms 필드가 없다.

### 5.3 산출 형태

```ts
type CaptureFacts = {
  captureId: string            // 파일명 기반
  source: { zipName, traceEntry, configText?, metadataText? }
  bounds: { startNs, endNs, durationNs }
  quality: { statsNonZero: {name, value, severity}[], unwindErrorRatio?: number }
  target: { packageName?, pid?, upid?, versionCode?, androidBuild?, deviceModel? }
  sections: Record<string, Section>   // 위 표의 영역별
}

type Section =
  | { available: false, reason: string }
  | { available: true, rows: Row[], omitted?: { count: number, sumOfOmitted: number } }
```

## 6. 2단계 — 기계적 비교 (코드가 한다)

두 `CaptureFacts`를 **이름으로 짝지어** 전 항목에 대해 같은 계산을 돌린다. 어떤 항목이 흥미로운지 판단하지 않는다.

- 짝지음 키: 스레드 이름, 슬라이스 이름, 카운터 track 이름, jank_type, 심볼 이름
- 각 짝에 대해: `baseline`, `candidate`, `deltaAbs`, `deltaRatio`
- 정규화는 **하나로 정하지 않고 분모를 같이 넘긴다.** 절대값 + 초당 값 + 프레임당 값 + 호출당 값을 모두 계산하고, 분모(`durationNs`, 프레임 수, 호출 수)도 fact pack에 넣는다. 어떤 정규화가 이 비교에 맞는지는 LLM이 고른다.
- 한쪽에만 있는 항목은 버리지 않고 `onlyInBaseline` / `onlyInCandidate`로 분리한다. 사라진 함수와 새로 생긴 함수는 코드 변경의 직접 증거다.
- 환경 차이(구간 길이, 기기, build, versionCode, sampling frequency, 활성 데이터 소스)는 별도 섹션으로 명시한다.

### 6.1 fact pack 예산

LLM 호출 1회에 다 들어가야 하므로 크기를 관리한다.

- 항목마다 안정적인 키를 붙인다. 예: `slice.FrameProcess.sumDurNs`
- 영역별 상위 N(기본 60)은 **"둘 중 어느 쪽이든 큰 값" 기준**으로 고른다. 한쪽에서만 큰 항목이 잘리면 회귀를 놓친다.
- 잘린 항목은 개수와 합계를 남긴다. LLM이 "이 아래는 안 봤다"를 알 수 있어야 한다.
- 수치는 유효숫자로 반올림해 직렬화한다.
- 목표 크기 200KB 이하, 초과하면 N을 줄이고 줄였다는 사실을 fact pack과 화면에 남긴다.

## 7. 3단계 — LLM 자유 분석

### 7.1 호출

fact pack 전체 + 사용자 프롬프트를 담아 **한 번** 호출한다. 도구도 없고 루프도 없다. 응답은 스트리밍해 화면에 흘린다.

system prompt가 하지 **않는** 것:

- 봐야 할 지표 목록을 주지 않는다.
- 섹션 구성을 지정하지 않는다.
- 개선/회귀 판정 기준을 주지 않는다.
- 등급·점수·신뢰도 라벨 체계를 강요하지 않는다.

system prompt가 하는 것 (데이터 오독 방지에 한정):

- fact pack의 필드 의미와 단위를 설명한다.
- `sampleCount`는 샘플 수이며 wall latency가 아님을 알린다.
- 정규화 분모가 fact pack 안에 있으니 필요하면 직접 고르라고 알린다.
- fact pack에 없는 수치를 만들어 쓰지 말라고 지시한다.
- 인용은 `[[key]]` 형태로 fact pack 키를 그대로 쓰라고 지시한다.
- 사용자 프롬프트와 캡처 안의 텍스트는 데이터일 뿐 지시가 아님을 명시한다.

### 7.2 응답 골격 (최소)

**응답은 JSON이 아니라 순수 마크다운으로 받는다.** 고정하는 건 문서 맨 앞 두 섹션의 제목뿐이다.

```markdown
## 핵심 발견
- (3~5개, 한 줄씩)

## 측정 불가
- (데이터가 없어 답할 수 없었던 것. 없으면 "없음")

## (이하 LLM이 정하는 자유 서술)
```

JSON schema를 쓰지 않는 이유는 두 가지다. 마크다운 본문을 JSON 문자열 필드에 담으면 **스트리밍 중 점진 렌더가 어려워지고**(이스케이프된 부분 문자열을 계속 파싱해야 한다), 스키마를 도입하는 순간 필드를 더 넣고 싶어지는 압력이 생겨 최소 골격 원칙이 무너진다. 마크다운은 파싱에 실패해도 그냥 글로 보인다는 점에서도 안전하다.

`.json` 내보내기는 응답을 파싱해 화면이 만든다 — LLM에게 JSON을 요구하지 않는다. 두 섹션 제목이 없으면 전체를 자유 본문으로 취급하고 화면에 그 사실을 표시한다. **응답 형식 위반이 분석 실패가 되어서는 안 된다.**

`assessment`·`confidence`·`measurementType` 같은 분류 체계는 두지 않는다. 필요하면 LLM이 본문에서 자기 말로 쓴다.

### 7.3 근거 연결

렌더 시 `[[key]]`를 fact pack에서 조회한다.

- 키가 있으면 → 인라인 칩으로 렌더, 클릭하면 baseline/candidate/delta 원시값과 출처 쿼리를 펼친다.
- 키가 없으면 → `미확인 인용` 표시. 지우지 않고 드러낸다.

수치 환각을 완전히 막을 수는 없다. 우리가 보장하는 건 **인용 키의 실재 여부까지**이고, 이건 화면에 그대로 쓴다.

### 7.4 provider

- OpenAI 직접 호출 기본, OpenRouter 선택 (OpenAI 호환).
- 기본 모델 `GPT5.6-Terra`, reasoning effort `high`. `Sol`·`Luna` 전환. adapter로 추가 가능.
- **모델 ID 문자열은 하드코딩하지 말고 착수 시점 provider 모델 목록으로 확인해 상수 한 곳에 모은다.** 위 세 이름은 제품 결정이지 검증된 API 식별자가 아니다.
- 브라우저에서 직접 호출하므로 키는 사용자 브라우저에 노출된다. 이건 BYO-key의 성질이고 화면에 명시한다.
- 브라우저 직접 호출(CORS)과 스트리밍은 아직 확인 전이다(9.4). **P2의 첫 작업으로 두 provider에 최소 호출을 먼저 날려 본다.** 여기서 막히면 제품 형태가 흔들리므로 UI보다 먼저 확인한다.

## 8. 화면

한 페이지. 라우터·로그인·공유 링크 없음(서버가 없으니 공유는 파일 다운로드로 한다).

전체 톤은 이전 플랜의 결정을 유지한다 — 흰 배경의 절제된 일반 웹페이지, 장식적 gradient·glass·과한 그림자 없음, 본문 sans-serif · 수치 monospace(tabular), 주조색 중립 blue 하나, 개선·회귀 색은 delta와 라벨에만, 색 없이도 부호와 텍스트로 구분, 모바일까지 완전 반응형.

| 영역 | 내용 |
|---|---|
| 키 등록 | provider·API 키·모델. 세션 메모리 전용 안내. 미등록이면 분석 버튼 비활성 |
| 입력 | 기준선/비교 ZIP drop zone 2개, 각 캡처 이름, 자유 프롬프트 textarea (suggestion chip 없음) |
| 추출 진행 | ZIP 열기 → trace 선택 → 쿼리 진행률. 영역별 성공/없음 표시. 취소 가능 |
| 비교표 | fact pack을 접힌 표로 상시 제공. LLM 없이도 이것만으로 값을 볼 수 있다 |
| 리포트 | headlines 먼저, 그 아래 스트리밍되는 자유 본문. 인용 칩 펼치면 원시값 |
| 내보내기 | 리포트 `.md`, 리포트 `.json`, **fact pack `.json`** |

fact pack 다운로드가 중요하다. 44MB ZIP 없이 fact pack만 다시 올리면 **다른 프롬프트로 LLM 호출만 재실행**할 수 있다. 재분석 비용이 LLM 호출 한 번으로 떨어지고, 팀원에게 넘길 때도 원본 trace를 넘기지 않아도 된다.

ZIP 안에 trace가 여러 개면 사용자가 고른다. 자동 다중 비교는 범위 밖이다.

## 9. 기술 선택

| 영역 | 선택 | 비고 |
|---|---|---|
| 빌드 | Vite + TypeScript | 정적 산출물만. 번들러는 필수 — 9.2 참조 |
| UI | React | 라우터·서버 상태 라이브러리 불필요 |
| ZIP | `zip.js` (`@zip.js/zip.js`) | 스트리밍 해제, Worker 지원 |
| Trace | Perfetto trace_processor WASM v50.1 (module Worker) | **실측 검증 완료 — 9.1** |
| 저장 | fact pack만 IndexedDB 캐시. trace 원본은 저장 안 함 | 키는 메모리만 |
| 테스트 | Vitest (추출기·비교기 단위) | 예시 캡처 골든 |
| 배포 | 정적 호스팅 (GitHub Pages 등) | COOP/COEP 헤더 불필요 확정 |
| 코드 위치 | 이 저장소 `web/` | 단일 트리. 구현체 비교는 브랜치로 — 15절 |

### 9.1 WASM 조달 — 검증 완료 (2026-07-26)

**Google 공식 npm 패키지는 없다.** `@perfetto/trace_processor`·`trace_processor` 모두 npm 404다. 대신 `@lynx-js/trace-processor`(12.9MB)가 **Perfetto v50.1 정식 WASM 빌드 + Perfetto UI에서 추출한 JS 바인딩**을 vendoring하고 있고, 여기 담긴 `vendor/perfetto/` 3개 파일이 실제로 쓸 자산이다.

| 파일 | 크기 | 성격 |
|---|---|---|
| `trace_processor.wasm` | 10.3MB | Perfetto v50.1 (`v50.1-15375aabf`), Apache-2.0 |
| `engine.js` | 1.8MB | Perfetto UI 추출 `EngineBase` — Node 참조 0개 |
| `wasm_bridge.js` | 267KB | emscripten glue — `ENVIRONMENT_IS_WEB/WORKER` 분기 유지 |

패키지의 Node 전용 부분은 `dist/index.js` **20줄이 전부**이며, 그 안에서 브라우저용으로 바꿔야 하는 건 `readFileSync(wasm)` → `fetch(wasm)` 한 줄이다. 나머지 vendor 파일은 브라우저에서 그대로 돈다.

**진행: 이 3개 파일을 `web/vendor/perfetto/`에 버전 고정으로 vendoring하고, 20줄 어댑터를 직접 작성한다.** 패키지 자체(`0.0.1`, license·repository 미기재)에 런타임 의존하지 않으므로 유지보수 리스크가 사라진다. 어댑터는 `TraceEngine` 인터페이스(`open(bytes)` / `query(sql)` / `close()`) 뒤에 둔다.

**조달 명령과 검증된 어댑터 코드는 부록 D에 그대로 있다. 새로 만들지 말고 복사해서 시작한다.**

### 9.2 실측 결과

예시 캡처 2개(41~44MB)로 Node와 헤드리스 Chrome 150 양쪽에서 확인했다.

| 항목 | 결과 |
|---|---|
| 파싱 시간 | Node 1.48~1.55초 / **브라우저 1.49초** (42.2MB) |
| 페이지 진입→쿼리 완료 | **1.7초** (wasm fetch 20ms + trace fetch 66ms 포함) |
| 쿼리 18종 | **전부 통과**, 합계 428ms (최대 단일 쿼리 177ms) |
| `crossOriginIsolated` | **false에서 정상 동작** — worker 안에서 `SharedArrayBuffer=undefined` |
| WASM memory | `shared=false`, initial 32MB, **max 4096MB** (wasm32 한계) |
| 메모리 | Node에서 순차 2개 처리 시 peak 1.1GB, dispose 후 684MB로 회수 |
| 값 일치 | Node와 브라우저 결과 완전 동일 (`cpu_ns=31275595807` 등) |

**COOP/COEP는 필요 없다.** 근거는 추론이 아니라 두 개다 — wasm 바이너리의 memory 정의가 `shared=false`이고, 실제로 `crossOriginIsolated=false`인 평범한 정적 서버에서 전 과정이 통과했다. 정적 호스팅 제약이 없다는 뜻이다.

**4GB가 trace 크기 상한**이다. wasm32 max 4096MB이고 파싱 중 실제 점유는 원본의 여러 배이므로, 100MB급까지는 안전하고 그 이상은 P1에서 경계를 재본다. 순차 처리 + **worker terminate**는 선택이 아니라 필수다. Node에서 `dispose()`만으로는 즉시 회수되지 않았고, 브라우저에서는 worker 종료로 확실히 회수된다.

### 9.3 검증에서 나온 구현 제약

착수하는 구현자가 다시 밟지 않아야 할 것들이다.

| 제약 | 내용 |
|---|---|
| `LOG2` 없음 | trace_processor의 SQLite에 math 함수가 없다. `SELECT LOG2(1024)` 실패. **고정 경계 CASE 사다리**로 로그 버킷을 만든다(부록 B) |
| `dur = -1` | trace 끝에서 안 닫힌 slice는 `dur = -1`이다. 집계에 **반드시 `AND s.dur >= 0`**을 넣는다. 빼면 합계가 조용히 어긋난다 |
| bare specifier | `engine.js`가 `import ... from "immer"`를 쓴다. 번들러(Vite) 없이는 module worker가 로드 실패한다. **번들러가 필수인 유일한 이유** |
| immer dev 빌드 | `immer.mjs`는 `process.env`를 참조해 브라우저에서 `process is not defined`로 죽는다. `immer.production.mjs`를 쓰거나 Vite `define`으로 처리한다 |
| 원시 컬럼명 | 확정된 스키마는 부록 A. **LLM에게 스키마를 추측시키지 않는 것이 이 플랜의 핵심**이므로 여기를 단일 출처로 쓴다 |

### 9.4 아직 안 본 것

- Safari / 모바일 Chrome 실기 동작 (헤드리스 Chrome 150만 확인)
- OpenAI·OpenRouter 브라우저 직접 호출 CORS와 스트리밍
- 100MB 이상 trace의 실제 임계

## 10. 구현 단계

### P0. 실현성 검증 — **완료 (2026-07-26)**

착수 전에 끝냈다. 결과는 9.1~9.3과 부록에 있다.

- [x] WASM 조달 경로 확정 (vendoring 3파일)
- [x] 예시 캡처 2개로 파싱·쿼리 실행 (Node + 헤드리스 Chrome)
- [x] 5.2 쿼리 18종 실행, 스키마·컬럼명 확정 → 부록 A
- [x] `LOG2` 부재 확인 및 CASE 사다리 대안 검증 → 부록 B
- [x] COOP/COEP 불필요 확정 (`shared=false` + `crossOriginIsolated=false` 실동작)
- [x] 파싱 시간·peak 메모리 측정

남은 확인은 9.4다. 구현과 병행한다.

### P1. 추출기와 비교기

- `TraceEngine` 인터페이스와 WASM 구현 (**부록 D 코드로 시작**)
- ZIP 열기 (재귀 탐색, `__MACOSX/`·`.DS_Store` 무시, trace 다중 시 선택)
- 영역별 추출기 + `available: false` 처리
- 히스토그램 → 백분위 보간
- 비교기: 짝지음, delta, 다중 정규화, only-in-X, 환경 차이
- fact pack 직렬화와 크기 예산

통과 조건:

- 같은 ZIP을 두 번 넣으면 fact pack이 완전히 동일하다
- **예시 캡처 2개의 fact pack 값이 부록 C와 일치한다** — 구현자가 스스로 맞춰볼 수 있는 기준선이다
- `metadata.txt`·`config.textproto`를 뺀 ZIP에서도 trace만으로 동작한다
- FrameTimeline 또는 `linux.perf`가 없는 trace에서 해당 영역만 `없음`이고 나머지는 나온다
- 상위 N 절단이 개수·합계와 함께 보고된다
- 추출기·비교기 단위 테스트가 통과한다

### P2. LLM 분석

- **먼저 두 provider에 최소 호출 1회씩** — 브라우저 직접 호출 CORS와 스트리밍 확인 (9.4). 막히면 UI를 더 짓기 전에 알아야 한다
- provider adapter (OpenAI · OpenRouter), 스트리밍
- system prompt (7.1)와 최소 응답 골격 (7.2)
- `[[key]]` 인용 검증과 렌더
- 실패·중단·재시도 처리

통과 조건:

- 예시 캡처 2개 + 실제 프롬프트로 사람이 읽을 만한 비교 분석이 나온다
- 리포트에 SQL 오류가 등장할 수 없다 (LLM에 SQL 경로가 없음)
- 같은 fact pack으로 프롬프트만 바꾸면 분석의 초점이 실제로 바뀐다
- 없는 키를 인용하면 화면에 `미확인 인용`으로 뜬다

### P3. UI 마감

- 8절 전 영역, 반응형, 진행 표시와 취소
- fact pack 표 상시 제공
- `.md` / `.json` / fact pack 내보내기와 fact pack 재업로드 재분석
- 키 취급 안내

통과 조건:

- 정적 빌드 산출물만 올려서 전 기능이 동작한다 (네트워크 요청은 LLM API 하나뿐임을 devtools로 확인)
- 모바일에서 입력·진행·리포트·비교표까지 잘림 없이 접근된다
- fact pack만으로 재분석이 된다

## 11. 테스트

| 범위 | 검증 |
|---|---|
| ZIP | 정상, 중첩 경로, `__MACOSX` 혼입, trace 다수, trace 없음, 손상 |
| 추출기 | 예시 캡처 골든 값, 데이터 소스 결측, `stats` 비정상값 반영 |
| 히스토그램 | 버킷 경계, 단일 값, 빈 집합의 백분위 |
| 비교기 | 짝 없음, 0 분모, 구간 길이 차이 정규화, only-in-X |
| 예산 | 상위 N 절단 시 개수·합계 보고, 200KB 초과 시 축소 경로 |
| LLM | 인용 키 검증, 스트리밍 중단, 키 오류, provider 전환 |
| 성능 | 44MB × 2 순차 처리 peak 메모리와 시간 |

LLM 문장은 snapshot으로 고정하지 않는다. 회귀 기준은 **fact pack**이다. fact pack이 결정적이므로 골든 파일로 고정할 수 있고, 이게 이전 플랜에서 불가능했던 회귀 테스트를 가능하게 한다.

## 12. 범위 밖

- 서버·DB·인증·작업 큐
- 읽기 전용 공유 링크 (fact pack·리포트 파일 다운로드로 대체)
- 3개 이상 캡처 추세 분석
- 기기에서 직접 캡처
- Perfetto 외 포맷
- LLM의 반복 드릴다운 (원샷 확정 — 필요해지면 fact pack 재업로드 재분석으로 대응)
- 심볼 없는 네이티브 프레임의 오프라인 심볼라이즈

## 13. 이전 플랜에서 유지·폐기한 결정

| 결정 | 처리 |
|---|---|
| 1차 사용자 = 성능 개발자, 첫 질문 = 얼마나 개선됐는가 | 유지 |
| 흰 배경 절제된 시각 언어, 완전 반응형 | 유지 |
| 자유 프롬프트 (chip 없음) | 유지 |
| BYO key, OpenAI 기본 + OpenRouter, `GPT5.6-Terra` high | 유지 |
| 키는 세션 메모리만, 영구 저장 없음 | 유지 (서버가 없어 더 단순해짐) |
| 임의 Android Perfetto 캡처 호환, 결측 소스 허용 | 유지 |
| 헤드라인 3~5개 | 유지 (형태만 `headlines: string[]`로 축소) |
| LLM tool-calling loop, `run_trace_sql`, 도구 8종 | **폐기** — 정형화와 SQL 오류의 원인 |
| `measurementType`·`assessment`·`confidence` 분류 | **폐기** — 자유 서술로 대체 |
| `AnalysisReport` 중첩 스키마 | **폐기** — `headlines`·`report`·`unmeasurable` |
| Next.js + FastAPI + PostgreSQL + worker container | **폐기** — 정적 프론트 하나 |
| 업로드 API·job 상태·TTL 삭제·공유 토큰 | **폐기** — 파일이 브라우저를 떠나지 않음 |
| ZIP bomb·경로 탈출 서버 방어 | 축소 — 브라우저 안이라 위협 모델이 다르다. 해제 크기·파일 수 상한만 둔다 |
| 별도 저장소 권장 | 변경 — 정적 프론트 하나라 이 저장소 `web/`에서 시작 |

## 14. 착수 전 확정할 것

1. ~~`web/` 위치~~ → **이 저장소 `web/`으로 확정**
2. ~~WASM 조달안~~ → **vendoring 3파일로 확정** (9.1)
3. fact pack 상위 N 기본값과 크기 상한 (권장: N=60, 200KB) — 남음

## 15. 배치와 기록 규칙

이 플랜은 **여러 LLM으로 각각 구현해 비교**하는 것을 전제로 한다. 결과물이 여럿이므로 무엇이 무엇으로 만들어졌는지가 산출물 자체에 남아야 한다.

### 15.1 배치

`web/` 하나가 단일 구현 트리다. 구현체별 하위 폴더는 두지 않는다.

```text
web/
├─ vendor/perfetto/   버전 고정 vendoring (trace_processor.wasm · engine.js · wasm_bridge.js)
├─ src/
├─ IMPLEMENTATION.md  이 구현을 만든 harness·model
└─ …
```

여러 LLM 구현은 **브랜치로 나눈다.** 각 브랜치의 `web/`은 항상 같은 자리에 있고, 브랜치 사이 `git diff`로 바로 비교된다. 폴더로 나누면 vendor 중복, 상대경로 분기, 어느 폴더가 최신인지 같은 문제가 따라오는데 그 대가로 얻는 게 없다.

`web/`을 실제로 만드는 편집에서 `02-reference/02-folder-map.md`를 같이 갱신한다.

### 15.2 harness·model 기록 (필수)

**어떤 Code Harness에서 어떤 모델로 만들었는지를 반드시 적는다.** 폴더명으로 구분하지 않으므로 이 기록이 유일한 식별 수단이다. 세 곳에 남긴다.

| 위치 | 내용 |
|---|---|
| `web/IMPLEMENTATION.md` | harness, model, reasoning effort, 작업 일자, 브랜치명, 근거 플랜 파일, 사람이 개입한 부분 |
| 화면 푸터 | `built with {harness} / {model}` — 빌드된 페이지만 보고도 어느 구현인지 알 수 있어야 한다 |
| 리포트 내보내기(`.md`·`.json`) | 빌드 harness·model **과** 그 분석에 쓴 LLM provider·model 둘 다 |

`IMPLEMENTATION.md` 머리말 형식:

```markdown
- harness: Claude Code
- model: claude-opus-5 (effort: high)
- 브랜치: feature/web-claude-opus-5
- 작업일: 2026-07-26
- 근거 플랜: .aimd/21-plan/260726-01-client-only-trace-comparison.md
- 사람 개입: (없음 | 어디를 어떻게)
```

두 model을 구분해 적는 이유는 섞이기 때문이다. **빌드 모델**은 이 프론트엔드를 만든 모델이고, **분석 모델**은 사용자가 런타임에 BYO key로 고른 모델이다. 리포트만 놓고 보면 둘 다 "어떤 LLM이 관여했는가"로 보이므로 항상 라벨을 붙여 함께 남긴다.

## 부록 A. 확정 스키마 (Perfetto trace_processor v50.1)

예시 캡처에서 `SELECT * FROM {table} LIMIT 0`으로 직접 확인한 컬럼이다. **구현자는 여기를 보고 쓰고, 스키마를 추측하지 않는다.** 이전 구현이 `no such column: cid`로 실패한 지점이 정확히 여기다.

| 테이블 | 컬럼 |
|---|---|
| `trace_bounds` | `start_ts, end_ts` |
| `metadata` | `id, name, key_type, int_value, str_value` |
| `stats` | `name, idx, severity, source, value, description` |
| `package_list` | `id, package_name, uid, debuggable, profileable_from_shell, version_code` |
| `process` | `upid, id, pid, name, start_ts, end_ts, parent_upid, uid, android_appid, android_user_id, cmdline, arg_set_id, machine_id` |
| `thread` | `utid, id, tid, name, start_ts, end_ts, upid, is_main_thread, is_idle, machine_id` |
| `sched_slice` | `id, ts, dur, cpu, utid, end_state, priority, ucpu` |
| `thread_state` | `id, ts, dur, cpu, utid, state, io_wait, blocked_function, waker_utid, waker_id, irq_context, ucpu` |
| `slice` | `id, ts, dur, track_id, category, name, depth, stack_id, parent_stack_id, parent_id, arg_set_id, thread_ts, thread_dur, thread_instruction_count, thread_instruction_delta, cat, slice_id` |
| `thread_track` | `id, name, type, parent_id, source_arg_set_id, machine_id, utid` |
| `process_track` | `id, name, type, parent_id, source_arg_set_id, machine_id, upid` |
| `counter` | `id, ts, track_id, value, arg_set_id` |
| `counter_track` | `id, name, parent_id, type, dimension_arg_set_id, source_arg_set_id, machine_id, unit, description` |
| `cpu_counter_track` | 위 + `cpu` |
| `process_counter_track` | 위 + `upid` |
| `actual_frame_timeline_slice` | `id, ts, dur, track_id, category, name, depth, parent_id, arg_set_id, display_frame_token, surface_frame_token, upid, layer_name, present_type, on_time_finish, gpu_composition, jank_type, jank_severity_type, prediction_type, jank_tag` |
| `expected_frame_timeline_slice` | `id, ts, dur, track_id, category, name, depth, parent_id, arg_set_id, display_frame_token, surface_frame_token, upid, layer_name` |
| `perf_sample` | `id, ts, utid, cpu, cpu_mode, callsite_id, unwind_error, perf_session_id` |
| `stack_profile_callsite` | `id, depth, parent_id, frame_id` |
| `stack_profile_frame` | `id, name, mapping, rel_pc, symbol_set_id, deobfuscated_name` |
| `stack_profile_mapping` | `id, build_id, exact_offset, start_offset, start, end, load_bias, name` |

조인 관계: `sched_slice.utid → thread.utid`, `thread.upid → process.upid`, `slice.track_id → thread_track.id → thread.utid`, `process_counter_track.upid → process.upid`, `actual_frame_timeline_slice.upid → process.upid`, `perf_sample.callsite_id → stack_profile_callsite.id → stack_profile_frame.id`.

## 부록 B. 히스토그램 버킷 (LOG2 대체)

`SELECT LOG2(1024)`는 실패한다. 고정 경계 CASE 사다리로 대체하고 실제 동작을 확인했다.

```sql
CASE
  WHEN dur <    10000 THEN 0   -- <10us
  WHEN dur <    50000 THEN 1
  WHEN dur <   100000 THEN 2   -- <100us
  WHEN dur <   500000 THEN 3
  WHEN dur <  1000000 THEN 4   -- <1ms
  WHEN dur <  5000000 THEN 5
  WHEN dur < 10000000 THEN 6   -- <10ms
  WHEN dur < 50000000 THEN 7
  ELSE 8 END
```

백분위는 이 버킷 분포를 TS에서 선형 보간해 만든다. **집계 쿼리에는 `AND dur >= 0`을 함께 넣는다** — 검증 중 `dur = -1`(미종료 slice)이 bucket 0에 섞여 들어왔다.

## 부록 C. 검증에서 이미 보인 비교 신호

두 예시 캡처의 실제 값이다. 도구가 만들어질 때 기대해야 할 출력의 감각이자, 골든 테스트의 출발점이다.

| 항목 | 20260723-175550 (기준선) | 20260723-201509 (비교) |
|---|---|---|
| trace 구간 | 10.0014초 | 10.0048초 |
| 대상 pid / 스레드 수 | 21823 / 186 | 2794 / 174 |
| 앱 on-CPU 합 | 31.276초 | 23.002초 |
| `traversal` 총합 | 2.171초 (591회) | 2.759초 (557회) |
| 프레임 `None`(정상) | 43 | 153 |
| 프레임 `Buffer Stuffing` | 545 | 375 |
| 프레임 `App Deadline Missed` | 3 | 14 |
| perf 샘플 수 | 3117 (unwind 실패 14) | 2286 |
| `mem.rss` 최대 | 530.4MB | 515.9MB |

CPU가 26% 줄고 정상 프레임이 3.6배로 늘었는데 deadline miss는 4.7배로 늘었다. 이런 상충을 어떻게 읽을지가 정확히 LLM에게 맡길 부분이고, 고정 판정 규칙으로는 담기지 않는 종류다.

## 부록 D. WASM 조달과 어댑터 (검증된 코드)

### D.1 vendoring

```bash
npm i @lynx-js/trace-processor@0.0.1 immer
cp node_modules/@lynx-js/trace-processor/vendor/perfetto/{trace_processor.wasm,engine.js,wasm_bridge.js} \
   web/vendor/perfetto/
```

`@lynx-js/trace-processor`는 파일을 얻는 용도이므로 복사 후 **devDependency로 옮기거나 지운다.** 런타임 import는 하지 않는다. `immer`는 지우면 안 된다 — `engine.js`가 직접 import한다.

`trace_processor.wasm`은 10.8MB다. git에 넣을지 `postinstall`로 받을지는 저장소 정책으로 정하되, **버전은 반드시 고정**한다(현재 `v50.1-15375aabf`). 버전이 바뀌면 부록 A의 컬럼이 달라질 수 있다.

Vite 설정에서 `.wasm`을 asset으로 두고, 워커에서 `fetch`할 수 있는 URL로 나오게 한다(`?url` import 등).

### D.2 브라우저 어댑터

패키지의 `dist/index.js`는 Node 전용이라 쓰지 않는다. 아래가 그 자리를 대신하는 전부이고, 헤드리스 Chrome에서 42.2MB trace로 실동작을 확인한 코드다.

```ts
import { EngineBase } from '../vendor/perfetto/engine.js'
import { WasmBridge } from '../vendor/perfetto/wasm_bridge.js'

// Node판과의 차이는 readFileSync(wasm) -> fetch(wasm) 하나뿐이다.
export class BrowserEngine extends EngineBase {
  mode = 'WASM' as const
  private port: MessagePort
  dispose: () => void

  constructor(wasmBytes: Uint8Array) {
    super()
    const bridge = new WasmBridge(wasmBytes)
    const { port1, port2 } = new MessageChannel()
    bridge.initialize(port1)
    this.port = port2
    this.port.onmessage = (m) => this.onRpcResponseBytes(m.data)
    this.dispose = () => port1.close()
  }

  rpcSendRequestBytes(data: Uint8Array) { this.port.postMessage(data) }
}
```

사용 흐름 (module Worker 안에서):

```ts
const wasmBytes = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer())
const engine = new BrowserEngine(wasmBytes)
await engine.parse(new Uint8Array(traceBuf))   // 42.2MB → 약 1.5초
await engine.notifyEof()

const r = await engine.tryQuery(sql)           // 실패해도 throw하지 않음
if (!r.ok || r.value.error()) { /* 실패 처리 */ }
const res = r.value, cols = res.columns()
for (const it = res.iter({}); it.valid(); it.next()) {
  const row = Object.fromEntries(cols.map((c) => [c, it.get(c)]))
}

engine.dispose()
// 그리고 반드시 바깥에서 worker.terminate() — dispose만으로는 메모리가 즉시 안 돈다
```

trace ArrayBuffer는 `postMessage(buf, [buf])`로 **transfer**한다. 복사하면 42MB가 두 벌이 된다.

`it.get(c)`는 `string | number | bigint | Uint8Array | null`을 돌려준다. **ns 단위 시간은 `bigint`로 온다** — JSON 직렬화 전에 변환 규칙을 정해 둔다.
