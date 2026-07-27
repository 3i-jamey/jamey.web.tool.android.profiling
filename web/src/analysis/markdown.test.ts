import { describe, expect, it } from 'vitest'
import { normalizeKoreanStrongSpacing } from './markdown'

describe('normalizeKoreanStrongSpacing', () => {
  it('adds a real Markdown space between closing strong syntax and Korean text', () => {
    expect(normalizeKoreanStrongSpacing('**1.716→0.742ms(-56.76%)**로 개선'))
      .toBe('**1.716→0.742ms(-56.76%)** 로 개선')
  })

  it('does not add duplicate spaces', () => {
    expect(normalizeKoreanStrongSpacing('**42회** 로 유지'))
      .toBe('**42회** 로 유지')
  })
})
