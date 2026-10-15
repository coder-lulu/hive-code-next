import { describe, expect, it } from 'vitest'
import { agentNoUpdateLabel } from './agent-row-decay-state'

const NOW = Date.parse('2026-10-15T00:00:00Z')

describe('agentNoUpdateLabel', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'does not invent an elapsed gap from an absent observation (%s)',
    (updatedAt) => {
      expect(agentNoUpdateLabel({ updatedAt }, NOW)).toBe('unconfirmed')
    }
  )

  it('does not age observations from before a restored process boundary', () => {
    expect(agentNoUpdateLabel({ updatedAt: NOW - 60_000, restoredUnconfirmed: true }, NOW)).toBe(
      'unconfirmed'
    )
  })

  it('keeps a real observation gap for a reporting session', () => {
    expect(agentNoUpdateLabel({ updatedAt: NOW - 34 * 60_000 }, NOW)).toBe('No update in 34m')
  })
})
