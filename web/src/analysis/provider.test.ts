import { describe, expect, it } from 'vitest'
import { buildAnalysisMessages, requestBody } from './provider'
import type { AnalysisSettings, AnalysisTurn, FactPack } from '../types'

const factPack = { schemaVersion: 1, sections: {} } as FactPack
const settings: AnalysisSettings = {
  provider: 'openai', apiKey: 'not-serialized', model: 'gpt-5.6-terra', reasoningEffort: 'high',
}

describe('analysis conversation', () => {
  it('sends the fact pack once and preserves prior turns in order', () => {
    const history: AnalysisTurn[] = [{
      id: 1,
      prompt: '첫 분석',
      response: '첫 응답',
      status: 'complete',
      settings: { provider: 'openai', model: 'gpt-5.6-terra', reasoningEffort: 'high' },
    }]
    const messages = buildAnalysisMessages(factPack, history, '더 자세히')
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(messages.filter((message) => message.content.includes('FACT PACK:'))).toHaveLength(1)
    expect(messages.at(-1)?.content).toContain('더 자세히')
  })

  it('uses the currently selected model and reasoning without serializing the API key', () => {
    const body = requestBody(settings, factPack, [], '분석')
    expect(body).toMatchObject({ model: 'gpt-5.6-terra', reasoning: { effort: 'high' } })
    expect(JSON.stringify(body)).not.toContain('not-serialized')
  })
})
