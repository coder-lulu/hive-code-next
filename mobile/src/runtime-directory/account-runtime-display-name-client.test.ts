import { beforeEach, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { updateAccountRuntimeDisplayName } from './account-runtime-display-name-client'

const dependencies = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../auth/mobile-sms-client', () => ({ request: dependencies.request }))

const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const session: MobileSession = {
  authorityId: 'hive-primary',
  account: { accountId: 'account-a', displayName: 'Fixture' },
  accessToken: 'fixture-token',
  refreshToken: 'fixture-refresh',
  expiresAt: 10_000,
  sessionExpiresAt: 10_000,
  sessionProfile: 'TRUSTED'
}

beforeEach(() => dependencies.request.mockReset())

it.each(['New alias', null])(
  'accepts the current ownership-fenced alias receipt for %s',
  async (name) => {
    const receipt = {
      runtimeRecordId,
      cloudDisplayName: name,
      cloudDisplayNameVersion: 4,
      ownershipEpoch: 2,
      updatedAt: '2026-10-03T00:00:00Z'
    }
    dependencies.request.mockResolvedValue(receipt)
    await expect(
      updateAccountRuntimeDisplayName(session, runtimeRecordId, name, 3)
    ).resolves.toEqual(receipt)
    expect(dependencies.request).toHaveBeenCalledWith(
      `/hive/v1/runtimes/${runtimeRecordId}`,
      { cloudDisplayName: name, expectedCloudDisplayNameVersion: 3 },
      { method: 'PATCH', headers: { Authorization: 'Bearer fixture-token' }, signal: undefined }
    )
  }
)

it('rejects an invalid ownership epoch in a successful HTTP receipt', async () => {
  dependencies.request.mockResolvedValue({
    runtimeRecordId,
    cloudDisplayName: 'New alias',
    cloudDisplayNameVersion: 4,
    ownershipEpoch: 0,
    updatedAt: '2026-10-03T00:00:00Z'
  })
  await expect(
    updateAccountRuntimeDisplayName(session, runtimeRecordId, 'New alias', 3)
  ).rejects.toThrow()
})
