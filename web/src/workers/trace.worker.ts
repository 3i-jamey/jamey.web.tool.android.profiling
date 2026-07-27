/// <reference lib="webworker" />

import wasmUrl from '../../vendor/perfetto/trace_processor.wasm?url'
import { BrowserEngine } from '../engine/browserEngine'
import { extractCaptureFacts } from '../extraction/extractor'
import type { CaptureSource, WindowSelectionRequest } from '../types'

type OpenMessage = { type: 'extract'; trace: ArrayBuffer; source: CaptureSource; windowRequest: WindowSelectionRequest }

self.onmessage = async (event: MessageEvent<OpenMessage>) => {
  if (event.data.type !== 'extract') return
  let engine: BrowserEngine | undefined
  try {
    self.postMessage({ type: 'progress', stage: 'WASM 로드', completed: 0, total: 1 })
    const wasmResponse = await fetch(wasmUrl)
    if (!wasmResponse.ok) throw new Error(`Perfetto WASM 로드 실패 (${wasmResponse.status})`)
    const wasmBytes = new Uint8Array(await wasmResponse.arrayBuffer())
    engine = new BrowserEngine(wasmBytes)
    self.postMessage({ type: 'progress', stage: 'trace 파싱', completed: 0, total: 1 })
    await engine.parse(new Uint8Array(event.data.trace))
    await engine.notifyEof()
    self.postMessage({ type: 'progress', stage: 'trace 파싱', completed: 1, total: 1 })
    const facts = await extractCaptureFacts(engine, event.data.source, event.data.windowRequest, (queryId, completed, total) => {
      self.postMessage({ type: 'progress', stage: queryId, completed, total })
    })
    self.postMessage({ type: 'result', facts })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  } finally {
    engine?.[Symbol.dispose]()
  }
}

export {}
