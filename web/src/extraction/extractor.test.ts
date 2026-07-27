import { describe, expect, it } from 'vitest'
import { percentileFromBuckets, stableHash, stablePart } from './extractor'

describe('percentileFromBuckets', () => {
  it('handles empty and single-bucket histograms', () => {
    expect(percentileFromBuckets(Array(9).fill(0), 0.5)).toBeUndefined()
    expect(percentileFromBuckets([10, 0, 0, 0, 0, 0, 0, 0, 0], 0.5)).toBe(5_000)
  })

  it('interpolates across fixed bucket boundaries', () => {
    expect(percentileFromBuckets([5, 5, 0, 0, 0, 0, 0, 0, 0], 0.75)).toBe(30_000)
  })
})

describe('stablePart', () => {
  it('normalizes citation key separators', () => {
    expect(stablePart(' Render / frame [0] ')).toBe('Render_frame_0_')
  })
})

describe('stableHash', () => {
  it('creates compact deterministic stack path keys', () => {
    const path = 'root > app.loop > app.operation'
    expect(stableHash(path)).toBe(stableHash(path))
    expect(stableHash(path)).toHaveLength(16)
    expect(stableHash(path)).not.toBe(stableHash(`${path}2`))
  })
})
