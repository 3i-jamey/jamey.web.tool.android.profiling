import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeKoreanStrongSpacing } from '../analysis/markdown'
import type { FactPack } from '../types'
import { ReportView } from './ReportView'

describe('ReportView', () => {
  it('renders GitHub-flavored Markdown tables', () => {
    const report = `## 핵심 발견

| Operation | Baseline | Candidate |
|---|---:|---:|
| traversal | 10 | 12 |

## 측정 불가
- 없음`
    const html = renderToStaticMarkup(
      <ReportView report={report} factPack={{ sections: {} } as FactPack} streaming={false} />,
    )

    expect(html).toContain('markdown-table-scroll')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>traversal</td>')
  })

  it('renders strong text followed immediately by a Korean particle', () => {
    const report = `## 핵심 발견

**1.716→0.742ms(-56.76%)**로 개선됐습니다.

## 측정 불가
- 없음`
    const html = renderToStaticMarkup(
      <ReportView report={report} factPack={{ sections: {} } as FactPack} streaming={false} />,
    )

    expect(normalizeKoreanStrongSpacing(report)).toContain('** 로')
    expect(html).toContain('<strong>1.716→0.742ms(-56.76%)</strong> 로')
  })

  it('colors semantically labeled improvements and regressions without showing labels', () => {
    const report = `## 핵심 발견

- **[개선] 1.716→0.742ms(-56.76%)**로 개선
- **[회귀] 3→14회(+366.7%)**로 증가
- **42회**는 방향 불확실

## 측정 불가
- 없음`
    const html = renderToStaticMarkup(
      <ReportView report={report} factPack={{ sections: {} } as FactPack} streaming={false} />,
    )

    expect(html).toContain('<strong class="metric-improvement">1.716→0.742ms(-56.76%)</strong> 로')
    expect(html).toContain('<strong class="metric-regression">3→14회(+366.7%)</strong> 로')
    expect(html).toContain('<strong>42회</strong>')
    expect(html).not.toContain('[개선]')
    expect(html).not.toContain('[회귀]')
  })
})
