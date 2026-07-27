import { useState } from 'react'
import { Children, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { citationIndex } from '../comparison'
import { citationsToLinks, validateCitations } from '../analysis/citations'
import { normalizeKoreanStrongSpacing } from '../analysis/markdown'
import type { ComparisonItem, FactPack } from '../types'

function SemanticStrong({ children }: { children?: ReactNode }) {
  const content = Children.toArray(children)
  const first = content[0]
  if (typeof first !== 'string') return <strong>{children}</strong>
  const match = first.match(/^\[(개선|회귀)\]\s*/)
  if (!match) return <strong>{children}</strong>
  content[0] = first.slice(match[0].length)
  return <strong className={match[1] === '개선' ? 'metric-improvement' : 'metric-regression'}>{content}</strong>
}

function Citation({ item, citationKey }: { item?: ComparisonItem; citationKey: string }) {
  const [open, setOpen] = useState(false)
  if (!item) return <span className="citation invalid" title={citationKey}>미확인 인용: {citationKey}</span>
  return (
    <span className="citation-wrap">
      <button className="citation valid" type="button" onClick={() => setOpen(!open)}>{citationKey}</button>
      {open && (
        <span className="citation-detail">
          <strong>{item.label} · {item.metric}</strong>
          <span>baseline: {String(item.baseline ?? '없음')}</span>
          <span>candidate: {String(item.candidate ?? '없음')}</span>
          <span>delta: {String(item.deltaAbs ?? '없음')} / ratio: {String(item.deltaRatio ?? '없음')}</span>
          <span>query: {item.sourceQuery.baseline ?? item.sourceQuery.candidate}</span>
        </span>
      )}
    </span>
  )
}

export function ReportView({
  report,
  factPack,
  streaming,
  expectSkeleton = true,
}: {
  report: string
  factPack: FactPack
  streaming: boolean
  expectSkeleton?: boolean
}) {
  const index = citationIndex(factPack)
  const citations = validateCitations(report, factPack)
  const followsSkeleton = report.includes('## 핵심 발견') && report.includes('## 측정 불가')
  return (
    <section className="report-section">
      <div className="report-meta">
        <span>{streaming ? '분석 스트리밍 중' : '분석 완료'}</span>
        <span>{citations.valid.length} verified citations</span>
        <span className="metric-legend"><b>개선</b><b>회귀</b></span>
        {citations.invalid.length > 0 && <span className="warning">{citations.invalid.length} unverified</span>}
      </div>
      {!streaming && expectSkeleton && !followsSkeleton && <p className="format-warning">응답이 권장 섹션 형식을 따르지 않아 전체를 자유 본문으로 표시합니다.</p>}
      <article className="markdown-report">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url.startsWith('fact:') ? url : defaultUrlTransform(url)}
          components={{
            table: ({ children }) => <div className="markdown-table-scroll"><table>{children}</table></div>,
            strong: ({ children }) => <SemanticStrong>{children}</SemanticStrong>,
            a: ({ href, children }) => {
              if (href?.startsWith('fact:')) {
                const key = decodeURIComponent(href.slice(5))
                return <Citation item={index.get(key)} citationKey={key} />
              }
              return <a href={href} target="_blank" rel="noreferrer">{children}</a>
            },
          }}
        >
          {normalizeKoreanStrongSpacing(citationsToLinks(report))}
        </ReactMarkdown>
        {streaming && <span className="stream-cursor" />}
      </article>
    </section>
  )
}
