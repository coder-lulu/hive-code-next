import { describe, expect, it } from 'vitest'
import { selectThresholdAssignment } from './palette-assignment-ranking'
import { indexPaletteField } from './indexed-field'
import type { TokenCandidate } from './match-document'

const qualities = [
  'word-exact',
  'word-prefix',
  'boundary-substring',
  'literal-substring',
  'compact',
  'typo'
] as const

function makeCandidate(value: number): TokenCandidate {
  const strength = value % qualities.length
  const quality = qualities[strength]
  const field = indexPaletteField({
    id: String(value),
    text: 'workspace',
    profile: 'structured-label',
    role: 'primary',
    destinationEligible: true
  })
  if (!field) {
    throw new Error('Expected an indexed fixture field')
  }
  return {
    hits: [{ field, match: { quality, ranges: [{ start: 0, end: 9 }] } }],
    quality,
    strength,
    recovery: strength >= 4 ? 1 : 0,
    wordMatch: strength >= 3 ? 1 : 0,
    coverage: Math.floor(value / 6) % 4,
    containerOnly: Math.floor(value / 24) % 2
  }
}

function exhaustiveWinner(groups: readonly TokenCandidate[][]): TokenCandidate[] | null {
  let winner: TokenCandidate[] | null = null
  let winnerScore: number[] | null = null
  const visit = (selected: TokenCandidate[]): void => {
    if (selected.length !== groups.length) {
      for (const candidate of groups[selected.length]) {
        visit([...selected, candidate])
      }
      return
    }
    const score = [
      Math.max(...selected.map((candidate) => candidate.recovery)),
      Math.max(...selected.map((candidate) => candidate.wordMatch)),
      Math.max(...selected.map((candidate) => candidate.coverage)),
      selected.reduce((sum, candidate) => sum + candidate.containerOnly, 0),
      selected.reduce((sum, candidate) => sum + candidate.recovery, 0),
      Math.max(...selected.map((candidate) => candidate.strength))
    ]
    const differing = winnerScore
      ? score.findIndex((value, index) => value !== winnerScore![index])
      : -1
    if (!winnerScore || (differing >= 0 && score[differing] < winnerScore[differing])) {
      winner = selected
      winnerScore = score
    }
  }
  visit([])
  return winner
}

describe('palette threshold selection', () => {
  it('matches exhaustive assignment ranking and source ties without mutating candidates', () => {
    for (let seed = 0; seed < 96; seed += 1) {
      const groups = Array.from({ length: 1 + (seed % 4) }, (_, token) =>
        Array.from({ length: 1 + ((seed + token) % 3) }, (_, entry) =>
          makeCandidate((seed * 13 + token * 19 + entry * 7) % 48)
        )
      )
      const original = groups.map((group) => [...group])
      const expected = exhaustiveWinner(groups)
      const diagnostics = { selectionCandidateVisits: 0 }
      const actual = selectThresholdAssignment(groups, diagnostics)
      expect(actual).toEqual(expected)
      actual?.forEach((candidate, index) => expect(candidate).toBe(expected?.[index]))
      expect(groups).toEqual(original)
      groups.forEach((group, index) =>
        group.forEach((candidate, entry) => expect(candidate).toBe(original[index][entry]))
      )
      expect(diagnostics.selectionCandidateVisits).toBeGreaterThan(0)
    }
  })

  it('refuses an empty token group and preserves the first equal candidate', () => {
    expect(selectThresholdAssignment([[makeCandidate(0)], []])).toBeNull()
    const first = makeCandidate(0)
    const second = makeCandidate(0)
    expect(selectThresholdAssignment([[first, second]])?.[0]).toBe(first)
  })
})
