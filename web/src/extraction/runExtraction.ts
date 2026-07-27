import type { CaptureFacts, CaptureSource, WindowSelectionRequest } from '../types'

export type WorkerProgress = { stage: string; completed: number; total: number }

export function runExtraction(
  traceBytes: Uint8Array,
  source: CaptureSource,
  windowRequest: WindowSelectionRequest,
  signal: AbortSignal,
  onProgress: (progress: WorkerProgress) => void,
): Promise<CaptureFacts> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/trace.worker.ts', import.meta.url), { type: 'module' })
    const stop = () => worker.terminate()
    const abort = () => {
      stop()
      reject(new DOMException('분석을 취소했습니다.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = (event) => {
      signal.removeEventListener('abort', abort)
      stop()
      reject(new Error(event.message || 'Trace worker가 중단됐습니다.'))
    }
    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress(message)
      } else if (message.type === 'result') {
        signal.removeEventListener('abort', abort)
        stop()
        resolve(message.facts)
      } else if (message.type === 'error') {
        signal.removeEventListener('abort', abort)
        stop()
        reject(new Error(message.message))
      }
    }
    const transferable = traceBytes.buffer.slice(traceBytes.byteOffset, traceBytes.byteOffset + traceBytes.byteLength)
    worker.postMessage({ type: 'extract', trace: transferable, source, windowRequest }, [transferable])
  })
}
