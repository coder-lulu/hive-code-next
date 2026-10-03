import type { AiBenefits } from './hive-ai-account'

export const aiBenefitsFixture: AiBenefits = {
  accountStatus: 'ACTIVE',
  group: 'vip',
  groupFreshness: 'CURRENT',
  subscriptionsFreshness: 'CURRENT',
  unit: 'POINTS',
  asOf: '2026-09-13T00:00:00Z',
  subscriptions: [
    {
      id: '9',
      planId: '7',
      title: 'Monthly',
      status: 'active',
      totalPoints: '9007199254740993',
      usedPoints: '7',
      remainingPoints: '9007199254740986',
      unlimited: false,
      expiresAt: '2026-10-01T00:00:00Z',
      resetsAt: '2026-09-15T00:00:00Z'
    },
    {
      id: '10',
      planId: '8',
      title: null,
      status: 'expired',
      totalPoints: null,
      usedPoints: '3',
      remainingPoints: null,
      unlimited: true,
      expiresAt: '2026-08-01T00:00:00Z',
      resetsAt: null
    }
  ]
}

export const largeAiBenefitsFixture: AiBenefits = {
  ...aiBenefitsFixture,
  subscriptions: Array.from({ length: 100 }, (_, index) => ({
    ...aiBenefitsFixture.subscriptions![0],
    id: String(9007199254740993n + BigInt(index)),
    planId: '9007199254740993',
    title: '套餐'.repeat(64),
    totalPoints: '9223372036854775807',
    usedPoints: '9007199254740993',
    remainingPoints: String(9223372036854775807n - 9007199254740993n)
  }))
}
