import type { PaletteIndexedField } from './indexed-field'

export function phrasePlacement(field: PaletteIndexedField, normalizedQuery: string): number {
  const text = field.text.normalized
  if (text.startsWith(normalizedQuery)) {
    return 0
  }
  // Merge the ordered occurrence and word-start streams: occurrences only count at word
  // starts, so each side advances monotonically and never rescans the other.
  let index = text.indexOf(normalizedQuery, 1)
  let wordIndex = 0
  while (index !== -1) {
    let wordStart = field.words[wordIndex]?.start
    while (wordStart !== undefined && wordStart < index) {
      wordIndex += 1
      wordStart = field.words[wordIndex]?.start
    }
    if (wordStart === undefined) {
      break
    }
    if (wordStart === index) {
      return 1
    }
    index = text.indexOf(normalizedQuery, wordStart)
  }
  return 2
}
