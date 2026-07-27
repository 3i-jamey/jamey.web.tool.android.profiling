import { describe, expect, it } from 'vitest'
import { citationsToLinks, citedKeys } from './citations'

describe('citation markup', () => {
  it('extracts and converts fact keys', () => {
    expect(citedKeys('value [[slices.render.totalDurationNs]] and [[missing]]')).toEqual([
      'slices.render.totalDurationNs',
      'missing',
    ])
    expect(citationsToLinks('[[a.b]]')).toBe('[a.b](fact:a.b)')
  })
})
