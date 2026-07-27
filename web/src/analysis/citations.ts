import { citationIndex } from '../comparison'
import type { FactPack } from '../types'

const CITATION = /\[\[([^\]\n]+)\]\]/g

export function citedKeys(markdown: string) {
  return [...markdown.matchAll(CITATION)].map((match) => match[1].trim())
}

export function validateCitations(markdown: string, factPack: FactPack) {
  const index = citationIndex(factPack)
  const keys = citedKeys(markdown)
  return {
    valid: keys.filter((key) => index.has(key)),
    invalid: keys.filter((key) => !index.has(key)),
  }
}

export function citationsToLinks(markdown: string) {
  return markdown.replace(CITATION, (_, rawKey: string) => {
    const key = rawKey.trim()
    return `[${key}](fact:${encodeURIComponent(key)})`
  })
}
