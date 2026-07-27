import type { ComparisonItem, FactPack } from '../types'

function metricValue(value: number | null, metric: string) {
  if (value === null) return '없음'
  if (/ms$/i.test(metric)) return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(value)} ms`
  if (/ns$/i.test(metric)) {
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(3)} s`
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(3)} ms`
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(2)} μs`
    return `${value.toFixed(0)} ns`
  }
  if (/ratio/i.test(metric)) return `${(value * 100).toFixed(2)}%`
  return new Intl.NumberFormat('ko-KR', { maximumSignificantDigits: 7 }).format(value)
}

function Delta({ item }: { item: ComparisonItem }) {
  if (item.deltaAbs === null) return <span className="muted">짝 없음</span>
  const sign = item.deltaAbs > 0 ? '+' : ''
  return (
    <span className={item.deltaAbs > 0 ? 'delta-positive' : item.deltaAbs < 0 ? 'delta-negative' : ''}>
      {sign}{metricValue(item.deltaAbs, item.metric)}
      {item.deltaRatio !== null && <small> ({item.deltaRatio > 0 ? '+' : ''}{(item.deltaRatio * 100).toFixed(1)}%)</small>}
    </span>
  )
}

export function ComparisonTable({ factPack }: { factPack: FactPack }) {
  return (
    <section className="comparison-section">
      <div className="section-heading">
        <span className="section-number">03</span>
        <div>
          <h2>결정적 비교표</h2>
          <p>{(factPack.budget.byteLength / 1024).toFixed(1)} KB fact pack · 영역당 상위 {factPack.budget.finalLimit}개</p>
        </div>
      </div>
      <div className="environment-strip">
        {factPack.environment.filter((item) => item.different).slice(0, 6).map((item) => (
          <span key={item.key}><strong>{item.key}</strong> {String(item.baseline ?? '없음')} → {String(item.candidate ?? '없음')}</span>
        ))}
        {!factPack.environment.some((item) => item.different) && <span>비교 환경 차이 없음</span>}
      </div>
      <div className="window-summary">
        <div>
          <span>BASELINE · REPRESENTATIVE · {factPack.baseline.window.source}</span>
          <strong>+{(factPack.baseline.window.startOffsetNs / 1e9).toFixed(3)}s → {factPack.baseline.window.durationNs / 1e6}ms</strong>
          <small>{factPack.baseline.window.profile.markerCount} loops · median {((factPack.baseline.window.profile.medianIntervalNs ?? 0) / 1e6).toFixed(2)}ms</small>
        </div>
        <div>
          <span>CANDIDATE · MATCHED · {factPack.candidate.window.source}</span>
          <strong>+{(factPack.candidate.window.startOffsetNs / 1e9).toFixed(3)}s → {factPack.candidate.window.durationNs / 1e6}ms</strong>
          <small>{factPack.candidate.window.profile.markerCount} loops · median {((factPack.candidate.window.profile.medianIntervalNs ?? 0) / 1e6).toFixed(2)}ms · score {factPack.candidate.window.similarityScore.toFixed(4)}</small>
        </div>
      </div>
      <div className="comparison-groups">
        {Object.entries(factPack.sections).map(([name, section]) => {
          const items = [...section.items, ...section.onlyInBaseline, ...section.onlyInCandidate]
          const displayName = name === 'perfStacks'
            ? 'Stack paths · perfStacks'
            : name === 'slices'
              ? 'Operations per 1000ms · slices'
            : name === 'perfFunctions'
              ? 'Function CPU · perfFunctions'
              : name === 'perfFunctionsByThread'
                ? 'Function CPU by thread · perfFunctionsByThread'
                : name
          return (
            <details key={name} className="comparison-group" open={name === 'processes' || name === 'slices' || name === 'frames' || name === 'perfFunctions'}>
              <summary>
                <span>{displayName}</span>
                <small>{items.length} metrics{section.omitted ? ` · ${section.omitted.count} omitted` : ''}</small>
                <span className="availability">
                  {section.available.baseline ? 'A 있음' : 'A 없음'} · {section.available.candidate ? 'B 있음' : 'B 없음'}
                </span>
              </summary>
              {items.length ? (
                <div className="table-scroll">
                  <table>
                    <thead><tr><th>항목</th><th>기준선</th><th>비교</th><th>Delta</th></tr></thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.key}>
                          <td><strong>{item.label}</strong><code>{item.metric}</code></td>
                          <td>{metricValue(item.baseline, item.metric)}</td>
                          <td>{metricValue(item.candidate, item.metric)}</td>
                          <td><Delta item={item} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="empty-row">{section.reason?.baseline ?? section.reason?.candidate ?? '비교할 수치가 없습니다.'}</p>}
            </details>
          )
        })}
      </div>
    </section>
  )
}
