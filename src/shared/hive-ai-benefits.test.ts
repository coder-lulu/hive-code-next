import { describe, expect, it } from 'vitest'
import { parseAiBenefits } from './hive-ai-account'
import { aiBenefitsFixture as fixture } from './hive-ai-benefits.test-fixture'

describe('current AI benefits contract', () => {
  it('preserves exact points, unavailable titles, unlimited and expired plans without private fields', () => {
    expect(parseAiBenefits({ ...fixture, access_token: 'private-canary' })).toEqual(fixture)
    expect(
      JSON.stringify(parseAiBenefits({ ...fixture, access_token: 'private-canary' }))
    ).not.toContain('private-canary')
  })
  it('distinguishes verified empty plans from independent unavailability', () => {
    expect(parseAiBenefits({ ...fixture, subscriptions: [] }).subscriptions).toEqual([])
    expect(
      parseAiBenefits({ ...fixture, group: null, groupFreshness: 'UNAVAILABLE' }).group
    ).toBeNull()
    expect(
      parseAiBenefits({ ...fixture, subscriptions: null, subscriptionsFreshness: 'UNAVAILABLE' })
        .subscriptions
    ).toBeNull()
  })
  it.each([
    { unit: 'NEW_API_QUOTA' },
    { accountStatus: 'DISABLED' },
    { group: null },
    { asOf: null },
    { subscriptions: null },
    { subscriptions: Array(101).fill(fixture.subscriptions![0]) },
    { subscriptions: [fixture.subscriptions![0], fixture.subscriptions![0]] },
    ...[
      { totalPoints: 9007199254740992 },
      { totalPoints: '9223372036854775808' },
      { usedPoints: '-1' },
      { remainingPoints: '9007199254740987' },
      { status: 'unknown' },
      { id: '0' },
      { title: 'x'.repeat(129) },
      { unlimited: true },
      { expiresAt: 'invalid' }
    ].map((change) => ({ subscriptions: [{ ...fixture.subscriptions![0], ...change }] }))
  ])('rejects inconsistent, unsafe or cross-state payloads: %j', (change) => {
    expect(() => parseAiBenefits({ ...fixture, ...change })).toThrow('invalid_ai_account_response')
  })
})
