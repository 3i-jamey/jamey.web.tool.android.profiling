import { describe, expect, it } from 'vitest'
import { reportJson, reportMarkdown } from './download'
import type { AnalysisTurn, FactPack } from './types'

const turns: AnalysisTurn[] = [
  {
    id: 1,
    prompt: '첫 질문',
    response: '첫 응답',
    status: 'complete',
    settings: { provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
  },
  {
    id: 2,
    prompt: '후속 질문',
    response: '후속 응답',
    status: 'complete',
    settings: { provider: 'openai', model: 'gpt-5.6-sol', reasoningEffort: 'medium' },
  },
]

describe('conversation export', () => {
  it('keeps every prompt, response, model, and reasoning setting', () => {
    const markdown = reportMarkdown(turns)
    expect(markdown).toContain('gpt-5.6-terra')
    expect(markdown).toContain('gpt-5.6-sol')
    expect(markdown).toContain('후속 질문')

    const json = JSON.parse(reportJson(turns, { schemaVersion: 1 } as FactPack))
    expect(json.conversation).toEqual(turns)
  })
})
