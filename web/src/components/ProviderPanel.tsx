import { PROVIDERS } from '../constants'
import type { AnalysisSettings, ProviderId } from '../types'

type Props = {
  settings: AnalysisSettings
  disabled?: boolean
  onChange: (settings: AnalysisSettings) => void
}

export function ProviderPanel({ settings, disabled, onChange }: Props) {
  const changeProvider = (provider: ProviderId) => onChange({
    ...settings,
    provider,
    model: PROVIDERS[provider].models[0],
  })
  return (
    <section className="provider-panel">
      <div className="section-heading compact">
        <span className="section-number">01</span>
        <div>
          <h2>분석 연결</h2>
          <p>키는 메모리에만 머물며 새로고침하면 사라집니다.</p>
        </div>
      </div>
      <div className="provider-grid">
        <label>
          Provider
          <select disabled={disabled} value={settings.provider} onChange={(event) => changeProvider(event.target.value as ProviderId)}>
            {Object.entries(PROVIDERS).map(([id, provider]) => <option key={id} value={id}>{provider.label}</option>)}
          </select>
        </label>
        <label>
          API key
          <input
            disabled={disabled}
            type="password"
            autoComplete="off"
            placeholder="세션 메모리 전용"
            value={settings.apiKey}
            onChange={(event) => onChange({ ...settings, apiKey: event.target.value })}
          />
        </label>
        <label>
          Model
          <select
            disabled={disabled}
            value={settings.model}
            onChange={(event) => onChange({ ...settings, model: event.target.value })}
          >
            {PROVIDERS[settings.provider].models.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label>
          Reasoning
          <select
            disabled={disabled}
            value={settings.reasoningEffort}
            onChange={(event) => onChange({ ...settings, reasoningEffort: event.target.value as AnalysisSettings['reasoningEffort'] })}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </div>
      <p className="privacy-note"><strong>BYO key:</strong> 브라우저가 provider API를 직접 호출합니다. 전송되는 것은 fact pack과 분석 요청뿐이며 trace 원본은 전송하지 않습니다.</p>
    </section>
  )
}
