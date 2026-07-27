# Perf stack path fact pack 보강 결과

- 일자: 2026-07-26
- 대상: `web/` 브라우저 단독 Trace 비교 도구
- 요청: leaf 심볼뿐 아니라 전체 stack trace를 fact pack에 포함

## 변경

- `stack_profile_callsite.parent_id`를 재귀적으로 따라 `root > ... > leaf` 호출 경로를 복원한다.
- `perfStacks` 영역에 경로별 `sampleCount`와 전체 perf 표본 대비 `sampleRatio`를 기록한다.
- 긴 경로는 표시용 label에 보존하고, 비교·인용 키는 결정적 FNV-1a 64-bit 해시로 줄인다.
- 재귀 깊이는 256 frame으로 방어하고 초과 경로에는 `[truncated]`를 표시한다.
- `sampleRatio`에는 초당·프레임당 정규화를 만들지 않으며, LLM에게 sample 수를 실행 시간이나 `ms/loop`로 환산하지 말도록 명시한다.

## 검증

- `npm test`: 4개 파일, 9개 테스트 통과.
- `npm run build`: TypeScript 검사와 Vite 프로덕션 빌드 통과.
- `npm run verify:samples`: 예시 ZIP 두 개에서 `perfStacks` 가용, 다중 frame 전체 경로와 해시 citation key 생성을 확인했다.
- stack path 포함 fact pack: 190,980 bytes로 200KB 제한 이내.

## 해석 범위

이 데이터로 호출 경로별 CPU 표본 비중의 증감과 추가·제거 경로를 비교할 수 있다. 정확한 메서드 실행 시간 또는 루프 1회당 ms는 앱의 Perfetto slice 계측 없이는 제공하지 않는다.
