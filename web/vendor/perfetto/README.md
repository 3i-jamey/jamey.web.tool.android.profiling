# Perfetto trace_processor (vendored)

브라우저에서 Perfetto trace를 파싱·조회하기 위한 WASM 엔진과 JS 바인딩이다.
**직접 수정하지 않는다.** 교체할 때는 아래 재현 절차로 통째로 갈아끼운다.

- Perfetto 버전: `v50.1-15375aabf`
- 라이선스: Apache-2.0 (`LICENSE`)
- 근거 플랜: `.aimd/21-plan/260726-01-client-only-trace-comparison.md` (9.1, 부록 D)

## 파일

| 파일 | 크기 | 역할 |
|---|---|---|
| `trace_processor.wasm` | 10.8MB | Perfetto trace_processor 본체 |
| `engine.js` | 1.8MB | Perfetto UI에서 추출한 `EngineBase` · `EngineProxy` |
| `wasm_bridge.js` | 267KB | emscripten glue (`WasmBridge`) |
| `engine.d.ts` · `wasm_bridge.d.ts` | — | 타입 선언 |

```text
sha256  trace_processor.wasm  c433e8daeed7ce3d176756fa5bf30eaa57eb037403eaeec4c2577dbc4b731375
sha256  engine.js             b4f36b5437541f48ebf710c036a645e25df9d7faa559d3a9e8a05bb1b93b7658
sha256  wasm_bridge.js        f54f017f5a500d79ff65e5a4bf50d8f2be5ed095a9237db68c7a0f80de0d72cb
```

## 재현 절차

Google은 trace_processor WASM을 npm에 공식 배포하지 않는다(`@perfetto/trace_processor` 404).
`@lynx-js/trace-processor`가 Perfetto 정식 빌드를 vendoring하고 있어 **파일을 얻는 용도로만** 쓴다.

```bash
npm i @lynx-js/trace-processor@0.0.1
cp node_modules/@lynx-js/trace-processor/vendor/perfetto/{LICENSE,trace_processor.wasm,engine.js,engine.d.ts,wasm_bridge.js,wasm_bridge.d.ts} \
   web/vendor/perfetto/
```

복사 후 `@lynx-js/trace-processor`는 **런타임 의존이 아니다.** 제거하거나 devDependency로 옮긴다.
그 패키지의 `dist/index.js`는 Node 전용이라 쓰지 않고, 브라우저 어댑터는 직접 작성한다(플랜 부록 D).

## 사용 시 주의

- **`immer`는 런타임 의존이다.** `engine.js`가 `import ... from "immer"`(bare specifier)를 쓴다.
  번들러 없이 module worker로 로드하면 실패하고, dev 빌드(`immer.mjs`)는 `process.env` 참조로
  브라우저에서 죽는다. Vite 프로덕션 빌드면 둘 다 자동으로 해결된다.
- SharedArrayBuffer를 쓰지 않는다(wasm memory `shared=false`). **COOP/COEP 헤더가 필요 없다.**
- wasm32 메모리 상한은 4096MB다. trace는 순차로 열고 **worker를 terminate해 회수**한다.
- 이 엔진의 SQLite에는 `LOG2` 등 math 함수가 없다(플랜 부록 B).
- 확정된 테이블 컬럼은 플랜 부록 A가 단일 출처다. 버전을 올리면 컬럼이 달라질 수 있다.
