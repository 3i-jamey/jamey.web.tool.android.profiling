import { useEffect, useRef, useState } from 'react'
import { extractTrace, type InspectedArchive } from './archive'
import { streamAnalysis } from './analysis/provider'
import { normalizeKoreanStrongSpacing } from './analysis/markdown'
import { cacheFactPack, loadCachedFactPack } from './cache'
import { compareCaptures } from './comparison'
import { ComparisonTable } from './components/ComparisonTable'
import { CaptureInput } from './components/CaptureInput'
import { ProviderPanel } from './components/ProviderPanel'
import { ReportView } from './components/ReportView'
import { ANALYSIS_WINDOW_NS, BUILD_INFO, PROVIDERS } from './constants'
import { downloadText, reportJson, reportMarkdown } from './download'
import { runExtraction } from './extraction/runExtraction'
import type { AnalysisSettings, AnalysisTurn, CaptureSource, FactPack } from './types'

type CaptureSlot = { archive: InspectedArchive; entry: string }
type BusyState = 'idle' | 'extracting' | 'analyzing'
const INITIAL_PROMPT = '변경 전후에서 중요한 성능 차이와 상충하는 신호를 찾아 원인을 해석해 주세요.'

function isFactPack(value: unknown): value is FactPack {
  if (!value || typeof value !== 'object') return false
  const pack = value as Partial<FactPack>
  const captureValid = (capture: FactPack['baseline'] | undefined) => Boolean(
    capture
    && typeof capture.captureId === 'string'
    && capture.source && typeof capture.source.zipName === 'string' && typeof capture.source.traceEntry === 'string'
    && capture.bounds && typeof capture.bounds.durationNs === 'number'
    && capture.traceBounds && typeof capture.traceBounds.durationNs === 'number'
    && capture.window && typeof capture.window.source === 'string' && typeof capture.window.durationNs === 'number'
    && capture.quality && Array.isArray(capture.quality.statsNonZero)
    && capture.target && typeof capture.target === 'object',
  )
  const sectionValid = (section: FactPack['sections'][string]) => Boolean(
    section
    && section.available && typeof section.available.baseline === 'boolean' && typeof section.available.candidate === 'boolean'
    && Array.isArray(section.items) && Array.isArray(section.onlyInBaseline) && Array.isArray(section.onlyInCandidate)
    && [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate].every((item) =>
      typeof item.key === 'string' && typeof item.label === 'string' && typeof item.metric === 'string'
      && item.sourceQuery && typeof item.sourceQuery === 'object',
    ),
  )
  return pack.schemaVersion === 1
    && captureValid(pack.baseline)
    && captureValid(pack.candidate)
    && Boolean(pack.denominators)
    && Array.isArray(pack.environment)
    && Boolean(pack.budget && typeof pack.budget.byteLength === 'number')
    && Boolean(pack.sections && Object.values(pack.sections).every(sectionValid))
}

export default function App() {
  const [settings, setSettings] = useState<AnalysisSettings>({
    provider: 'openai',
    apiKey: '',
    model: PROVIDERS.openai.models[0],
    reasoningEffort: 'high',
  })
  const [baseline, setBaseline] = useState<CaptureSlot>()
  const [candidate, setCandidate] = useState<CaptureSlot>()
  const [factPack, setFactPack] = useState<FactPack>()
  const [cachedPack, setCachedPack] = useState<FactPack>()
  const [prompt, setPrompt] = useState(INITIAL_PROMPT)
  const [turns, setTurns] = useState<AnalysisTurn[]>([])
  const [streamingResponse, setStreamingResponse] = useState('')
  const [activePrompt, setActivePrompt] = useState('')
  const [busy, setBusy] = useState<BusyState>('idle')
  const [progress, setProgress] = useState({ label: '', percent: 0 })
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | undefined>(undefined)
  const factInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadCachedFactPack().then((pack) => {
      if (isFactPack(pack)) setCachedPack(pack)
    }).catch(() => undefined)
  }, [])

  const resetConversation = (resetPrompt = true) => {
    setTurns([])
    setStreamingResponse('')
    setActivePrompt('')
    if (resetPrompt) setPrompt(INITIAL_PROMPT)
  }

  const updateSlot = (
    setter: (slot: CaptureSlot) => void,
    archive: InspectedArchive,
    entry: string,
  ) => {
    setter({ archive, entry })
    setFactPack(undefined)
    resetConversation(false)
    setError('')
  }

  const extract = async () => {
    if (!baseline || !candidate) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('extracting')
    setError('')
    resetConversation(false)
    try {
      const execute = async (slot: CaptureSlot, index: number, reference?: FactPack['baseline']['window']['profile']) => {
        const captureLabel = index === 0 ? '기준선' : '비교'
        setProgress({ label: `${captureLabel} ZIP 해제`, percent: index * 50 })
        const trace = await extractTrace(slot.archive, slot.entry)
        const source: CaptureSource = {
          zipName: slot.archive.file.name,
          traceEntry: slot.entry,
          configText: slot.archive.configText,
          metadataText: slot.archive.metadataText,
        }
        return runExtraction(trace, source, {
          durationNs: ANALYSIS_WINDOW_NS,
          reference,
        }, controller.signal, ({ stage, completed, total }) => {
          const local = total ? completed / total : 0
          setProgress({ label: `${captureLabel} · ${stage}`, percent: index * 50 + local * 50 })
        })
      }
      const baselineFacts = await execute(baseline, 0)
      const candidateFacts = await execute(candidate, 1, baselineFacts.window.profile)
      const nextPack = compareCaptures(baselineFacts, candidateFacts)
      setFactPack(nextPack)
      setCachedPack(nextPack)
      setProgress({ label: '비교 완료', percent: 100 })
      cacheFactPack(nextPack).catch(() => undefined)
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      abortRef.current = undefined
      setBusy('idle')
    }
  }

  const analyze = async () => {
    const question = prompt.trim()
    if (!factPack || !settings.apiKey || !settings.model || !question) return
    const controller = new AbortController()
    const turnSettings = {
      provider: settings.provider,
      model: settings.model,
      reasoningEffort: settings.reasoningEffort,
    }
    let generated = ''
    let completed = false
    abortRef.current = controller
    setBusy('analyzing')
    setError('')
    setStreamingResponse('')
    setActivePrompt(question)
    try {
      await streamAnalysis(settings, factPack, turns, question, controller.signal, (delta) => {
        generated += delta
        setStreamingResponse(generated)
      })
      completed = true
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (generated.trim()) {
        const normalizedResponse = normalizeKoreanStrongSpacing(generated)
        setTurns((current) => [...current, {
          id: current.length + 1,
          prompt: question,
          response: normalizedResponse,
          status: completed ? 'complete' : 'interrupted',
          settings: turnSettings,
        }])
        setPrompt('')
      }
      setStreamingResponse('')
      setActivePrompt('')
      abortRef.current = undefined
      setBusy('idle')
    }
  }

  const importFactPack = async (file?: File) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!isFactPack(parsed)) throw new Error('지원하는 fact pack JSON이 아닙니다.')
      setFactPack(parsed)
      resetConversation(false)
      setError('')
      await cacheFactPack(parsed)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const cancel = () => abortRef.current?.abort()
  const disabled = busy !== 'idle'

  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top">TRACE<sup>DIFF</sup></a>
        <span className="header-note">LOCAL PERFETTO COMPARISON</span>
      </header>
      <main id="top">
        <section className="hero">
          <div className="hero-kicker"><span /> Browser-only analysis</div>
          <h1>Trace의 차이를<br /><em>근거와 함께</em> 읽습니다.</h1>
          <p>두 Perfetto 캡처는 이 브라우저 안에서만 해제되고 측정됩니다. 코드는 수치를 고정하고, LLM은 무엇이 중요한지 자유롭게 해석합니다.</p>
          <div className="hero-facts">
            <span><strong>0</strong> server uploads</span>
            <span><strong>1+</strong> continuous LLM calls</span>
            <span><strong>100%</strong> deterministic facts</span>
          </div>
        </section>

        <ProviderPanel settings={settings} disabled={disabled} onChange={setSettings} />

        <section className="capture-section">
          <div className="section-heading">
            <span className="section-number">02</span>
            <div><h2>캡처 선택</h2><p>같은 시나리오의 변경 전·후 ZIP을 놓으세요.</p></div>
          </div>
          {!factPack && (
            <label className="initial-prompt-field">
              첫 분석 요청
              <textarea
                value={prompt}
                disabled={disabled}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
              />
              <small>ZIP 비교가 끝나면 이 프롬프트가 첫 LLM 분석 요청으로 그대로 이어집니다.</small>
            </label>
          )}
          <div className="capture-grid">
            <CaptureInput
              label="기준선 캡처"
              tone="baseline"
              archive={baseline?.archive}
              selectedEntry={baseline?.entry}
              disabled={disabled}
              onChange={(archive, entry) => updateSlot(setBaseline, archive, entry)}
              onError={setError}
            />
            <CaptureInput
              label="비교 캡처"
              tone="candidate"
              archive={candidate?.archive}
              selectedEntry={candidate?.entry}
              disabled={disabled}
              onChange={(archive, entry) => updateSlot(setCandidate, archive, entry)}
              onError={setError}
            />
          </div>
          <p className="window-selection-note">FrameTimeline cadence로 기준선 대표 {ANALYSIS_WINDOW_NS / 1e6}ms와 가장 유사한 비교 구간을 자동 선택합니다. FrameTimeline이 없으면 trace 중앙 구간을 사용합니다.</p>
          <div className="capture-actions">
            <button className="primary-action" type="button" disabled={!baseline || !candidate || disabled} onClick={() => void extract()}>
              캡처 추출 및 비교
            </button>
            <span>또는</span>
            <input ref={factInput} hidden type="file" accept="application/json,.json" onChange={(event) => void importFactPack(event.target.files?.[0])} />
            <button className="secondary-action" type="button" disabled={disabled} onClick={() => factInput.current?.click()}>fact pack 불러오기</button>
          </div>
          {cachedPack && !factPack && (
            <button className="cache-restore" type="button" onClick={() => setFactPack(cachedPack)}>
              이전 비교 복원: {cachedPack.baseline.captureId} → {cachedPack.candidate.captureId}
            </button>
          )}
          {busy === 'extracting' && (
            <div className="progress-box">
              <div><strong>{progress.label}</strong><span>{Math.round(progress.percent)}%</span></div>
              <progress max="100" value={progress.percent} />
              <button className="text-button" type="button" onClick={cancel}>취소</button>
            </div>
          )}
          {error && <div className="error-box" role="alert"><strong>작업을 완료하지 못했습니다.</strong><span>{error}</span></div>}
        </section>

        {factPack && (
          <>
            <ComparisonTable factPack={factPack} />
            <section className="analysis-section">
              <div className="section-heading">
                <span className="section-number">04</span>
                <div><h2>자유 분석</h2><p>이전 답변의 문맥을 유지하며 후속 질문을 계속할 수 있습니다.</p></div>
              </div>
              {turns.length > 0 && (
                <div className="conversation">
                  {turns.map((turn, index) => (
                    <section className="analysis-turn" key={turn.id}>
                      <div className="turn-heading">
                        <span>질문 {turn.id}</span>
                        <code>{turn.settings.model} · {turn.settings.reasoningEffort}</code>
                        {turn.status === 'interrupted' && <strong>중단됨</strong>}
                      </div>
                      <blockquote className="user-question">{turn.prompt}</blockquote>
                      <ReportView report={turn.response} factPack={factPack} streaming={false} expectSkeleton={index === 0} />
                    </section>
                  ))}
                </div>
              )}
              {busy === 'analyzing' && activePrompt && (
                <section className="analysis-turn active">
                  <div className="turn-heading">
                    <span>질문 {turns.length + 1}</span>
                    <code>{settings.model} · {settings.reasoningEffort}</code>
                    <strong>생성 중</strong>
                  </div>
                  <blockquote className="user-question">{activePrompt}</blockquote>
                  {streamingResponse
                    ? <ReportView report={streamingResponse} factPack={factPack} streaming expectSkeleton={turns.length === 0} />
                    : <p className="waiting-response">응답을 기다리는 중입니다.</p>}
                </section>
              )}
              <div className="conversation-composer">
                <div className="composer-heading">
                  <strong>{turns.length ? '후속 질문' : '첫 분석 요청'}</strong>
                  {turns.length > 0 && (
                    <button className="text-button" type="button" disabled={disabled} onClick={() => resetConversation()}>새 분석 대화</button>
                  )}
                </div>
                <textarea
                  value={prompt}
                  aria-label={turns.length ? '후속 질문' : '첫 분석 요청'}
                  disabled={busy === 'analyzing'}
                  placeholder={turns.length ? '앞선 분석에서 더 확인할 내용을 입력하세요.' : undefined}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                />
              </div>
              <div className="analysis-actions">
                {busy === 'analyzing' ? (
                  <button className="secondary-action" type="button" onClick={cancel}>분석 중단</button>
                ) : (
                  <button className="primary-action" type="button" disabled={!settings.apiKey || !settings.model || !prompt.trim()} onClick={() => void analyze()}>
                    {turns.length ? '후속 질문 보내기' : 'LLM 분석 시작'}
                  </button>
                )}
                {!settings.apiKey && <span>분석하려면 위에서 API key를 입력하세요.</span>}
              </div>
              {turns.length > 0 && <p className="conversation-cost">후속 호출마다 fact pack과 이전 대화 전체를 다시 전송하므로 대화가 길어질수록 토큰 사용량이 증가합니다. 각 질문 전에 모델과 reasoning을 변경할 수 있습니다.</p>}
              <div className="export-row">
                <span>EXPORT</span>
                <button type="button" disabled={!turns.length} onClick={() => downloadText('trace-comparison.md', reportMarkdown(turns), 'text/markdown;charset=utf-8')}>report.md</button>
                <button type="button" disabled={!turns.length} onClick={() => downloadText('trace-comparison.json', reportJson(turns, factPack), 'application/json')}>report.json</button>
                <button type="button" onClick={() => downloadText('fact-pack.json', JSON.stringify(factPack, null, 2), 'application/json')}>fact-pack.json</button>
              </div>
            </section>
          </>
        )}
      </main>
      <footer>
        <span>Trace Difference · files stay local</span>
        <span>built with {BUILD_INFO.harness} / {BUILD_INFO.model}</span>
      </footer>
    </>
  )
}
