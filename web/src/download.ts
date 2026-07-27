import { BUILD_INFO } from './constants'
import type { AnalysisTurn, FactPack } from './types'

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function reportMarkdown(turns: AnalysisTurn[]) {
  return `<!-- build-harness: ${BUILD_INFO.harness} -->
<!-- build-model: ${BUILD_INFO.model} (${BUILD_INFO.reasoningEffort}) -->

${turns.map((turn) => `## 분석 ${turn.id}

- provider: ${turn.settings.provider}
- model: ${turn.settings.model}
- reasoning: ${turn.settings.reasoningEffort}
- status: ${turn.status}

### 질문

${turn.prompt}

### 응답

${turn.response}`).join('\n\n---\n\n')}`
}

export function reportJson(turns: AnalysisTurn[], factPack: FactPack) {
  return JSON.stringify({
    build: BUILD_INFO,
    conversation: turns,
    factPack,
  }, null, 2)
}
