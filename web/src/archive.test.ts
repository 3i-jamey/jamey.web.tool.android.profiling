import { describe, expect, it } from 'vitest'
import { isTraceCandidate, parseMetadata } from './archive'

describe('archive helpers', () => {
  it('recognizes supported traces and large extensionless files', () => {
    expect(isTraceCandidate('nested/a.perfetto-trace', 1)).toBe(true)
    expect(isTraceCandidate('trace', 2 * 1024 * 1024)).toBe(true)
    expect(isTraceCandidate('metadata.txt', 2 * 1024 * 1024)).toBe(false)
  })

  it('parses metadata values containing equals signs', () => {
    expect(parseMetadata('package=app.test\nvalue=a=b\n')).toEqual({ package: 'app.test', value: 'a=b' })
  })
})
