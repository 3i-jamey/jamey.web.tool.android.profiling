import { EngineBase } from '../../vendor/perfetto/engine.js'
import { WasmBridge } from '../../vendor/perfetto/wasm_bridge.js'

export class BrowserEngine extends EngineBase {
  readonly id = 'browser-wasm'
  readonly mode = 'WASM' as const
  private readonly requestPort: MessagePort
  private readonly bridgePort: MessagePort
  private disposed = false

  constructor(wasmBytes: Uint8Array) {
    super()
    const bridge = new WasmBridge(wasmBytes)
    const { port1, port2 } = new MessageChannel()
    bridge.initialize(port1)
    this.bridgePort = port1
    this.requestPort = port2
    this.requestPort.onmessage = (message) => this.onRpcResponseBytes(message.data)
  }

  rpcSendRequestBytes(data: Uint8Array) {
    this.requestPort.postMessage(data)
  }

  [Symbol.dispose]() {
    if (this.disposed) return
    this.disposed = true
    this.requestPort.close()
    this.bridgePort.close()
  }
}
