import { describe, expect, it, vi } from 'vitest'
import {
  indexPaletteField,
  type PaletteIdentifierKind,
  type PaletteFieldProfile
} from './indexed-field'
import { matchPaletteField } from './match-field'
import { createPaletteQueryToken, preparePaletteQuery } from './palette-query'

describe('palette atom equality preserves source ranges', () => {
  it.each([
    ['token0x token0 token0', 'token0', 8, 14],
    ['prefix Café1 Café1', 'Café1', 7, 13],
    ['prefix 🚀1 🚀1', '🚀1', 7, 10]
  ] as const)('matches the first complete atom in %s', (text, query, start, end) => {
    const field = indexPaletteField({
      id: 'name',
      profile: 'structured-label',
      text,
      role: 'primary',
      destinationEligible: true
    })!
    const prepared = preparePaletteQuery(query)
    if (prepared.state !== 'ready') {
      throw new Error('Expected a ready query')
    }
    expect(matchPaletteField(field, prepared.tokens[0])).toEqual({
      quality: 'word-exact',
      ranges: [{ start, end }]
    })
  })
})

describe('palette field quality allocation', () => {
  it.each(['scan', 's', '123', 'scna', 'zzz'])(
    'does not allocate a Set per field for %s',
    (query) => {
      const profiles: PaletteFieldProfile[] = [
        'structured-label',
        'identifier',
        'path',
        'prose',
        'exact-alias'
      ]
      const fields = Array.from({ length: 1_000 }, (_, i) =>
        indexPaletteField({
          id: String(i),
          profile: profiles[i % profiles.length],
          text: 'scan daily 1234 workspace',
          role: 'primary',
          destinationEligible: true,
          ...(i % 2 === 0 ? { identifier: { kind: 'number' as const } } : {})
        })!
      )
      const token = createPaletteQueryToken(query, 0)
      let allocations = 0
      const NativeSet = globalThis.Set
      class CountedSet<T> extends NativeSet<T> {
        constructor(values?: Iterable<T> | null) {
          super(values)
          allocations++
        }
      }
      vi.stubGlobal('Set', CountedSet)
      try {
        for (const field of fields) {
          matchPaletteField(field, token)
        }
      } finally {
        vi.unstubAllGlobals()
      }
      expect(allocations).toBe(0)
    }
  )
})

describe('palette quality restrictions remain local to each match', () => {
  it.each<PaletteIdentifierKind>(['number', 'version', 'date', 'port', 'sha', 'key'])(
    'preserves prefix permissions for %s',
    (kind) => {
      const field = indexPaletteField({
        id: 'id',
        profile: 'identifier',
        text: '12345',
        role: 'primary',
        destinationEligible: true,
        identifier: { kind }
      })!
      const prefix = createPaletteQueryToken('123', 0)
      const exact = createPaletteQueryToken('12345', 0)
      const expected = ['port', 'sha', 'key'].includes(kind)
        ? { quality: 'field-prefix', ranges: [{ start: 0, end: 3 }] }
        : null
      expect(matchPaletteField(field, prefix)).toEqual(expected)
      expect(matchPaletteField(field, exact)).toEqual({
        quality: 'field-exact',
        ranges: [{ start: 0, end: 5 }]
      })
      expect(matchPaletteField(field, prefix)).toEqual(expected)
    }
  )

  it.each<PaletteFieldProfile>(['structured-label', 'identifier', 'path', 'prose', 'exact-alias'])(
    'preserves typo restrictions for %s without mutating the profile',
    (profile) => {
      const field = indexPaletteField({
        id: 'id',
        profile,
        text: 'scan',
        role: 'primary',
        destinationEligible: true
      })!
      expect(matchPaletteField(field, createPaletteQueryToken('s', 0))).toEqual({
        quality: 'field-prefix',
        ranges: [{ start: 0, end: 1 }]
      })
      expect(matchPaletteField(field, createPaletteQueryToken('scam', 0))).toEqual(
        ['structured-label', 'prose'].includes(profile)
          ? { quality: 'typo', ranges: [{ start: 0, end: 4 }] }
          : null
      )
    }
  )
})
