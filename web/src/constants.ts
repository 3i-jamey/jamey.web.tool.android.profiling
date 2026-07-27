import type { ProviderId } from './types'

export const BUILD_INFO = {
  harness: 'OpenCode',
  model: 'openai/gpt-5.6-sol',
  reasoningEffort: 'high',
} as const

export const PROVIDERS: Record<ProviderId, { label: string; endpoint: string; models: string[] }> = {
  openai: {
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/responses',
    models: ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-luna'],
  },
  openrouter: {
    label: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    models: ['openai/gpt-5.6-terra', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-luna'],
  },
}

export const DEFAULT_SECTION_LIMIT = 60
export const FACT_PACK_MAX_BYTES = 1_000_000
export const ANALYSIS_WINDOW_NS = 1_000_000_000
export const MAX_ARCHIVE_ENTRIES = 2_000
export const MAX_TRACE_BYTES = 512 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024
