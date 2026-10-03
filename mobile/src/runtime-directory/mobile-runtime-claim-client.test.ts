import { beforeEach, expect, it, vi } from 'vitest'
import {
  approveMobileRuntimeClaim,
  previewMobileRuntimeClaim,
  startMobileRuntimeClaimSms
} from './mobile-runtime-claim-client'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  uuid: vi.fn(() => '11111111-1111-4111-8111-111111111111')
}))
vi.mock('../auth/mobile-sms-client', () => ({ request: api.request }))
vi.mock('expo-crypto', () => ({ randomUUID: api.uuid }))
const session = { accessToken: 'test-access-token' }
const preview = {
  challengeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  runtimeRecordId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  runtimeVersion: '1.5.0',
  expectedVersion: 3,
  expiresAt: new Date(Date.now() + 300_000).toISOString()
}
beforeEach(() => vi.clearAllMocks())

it('normalizes the desktop claim code and uses authenticated preview without URL credentials', async () => {
  api.request.mockResolvedValue(preview)
  const signal = new AbortController().signal
  expect(await previewMobileRuntimeClaim(session, ' abcd-efgh ', signal)).toEqual(preview)
  expect(api.request).toHaveBeenCalledWith(
    '/hive/v1/runtime-claim-challenges/preview',
    { userCode: 'ABCD-EFGH' },
    expect.objectContaining({
      signal,
      headers: { Authorization: 'Bearer test-access-token' },
      credentials: 'omit',
      redirect: 'error'
    })
  )
})

it('rejects malformed codes before requesting and malformed or expired previews', async () => {
  await expect(previewMobileRuntimeClaim(session, 'invalid')).rejects.toThrow()
  expect(api.request).not.toHaveBeenCalled()
  for (const result of [
    { ...preview, expectedVersion: 0 },
    { ...preview, runtimeRecordId: 'not-a-runtime' },
    { ...preview, expiresAt: new Date(0).toISOString() }
  ]) {
    api.request.mockResolvedValue(result)
    await expect(previewMobileRuntimeClaim(session, 'ABCD-EFGH')).rejects.toThrow()
  }
})

it('binds SMS issuance and approval to the reviewed version and validates the approval identity', async () => {
  const sms = {
    challengeId: 'sms-challenge',
    expiresInSeconds: 120,
    resendAfterSeconds: 60,
    phoneNumberMasked: '+86 138****0000'
  }
  api.request.mockResolvedValueOnce(sms)
  expect(await startMobileRuntimeClaimSms(session, 'ABCD-EFGH', preview)).toEqual(sms)
  expect(api.request.mock.calls[0].slice(0, 2)).toEqual([
    '/hive/v1/runtime-claim-challenges/sms-challenges',
    { userCode: 'ABCD-EFGH', expectedVersion: 3 }
  ])
  const approval = { ...preview, status: 'APPROVED', resourceVersion: 4 }
  api.request.mockResolvedValueOnce(approval)
  await approveMobileRuntimeClaim(session, 'ABCD-EFGH', preview, sms, '123456')
  expect(api.request.mock.calls[1]).toEqual([
    '/hive/v1/runtime-claim-challenges/approve',
    {
      userCode: 'ABCD-EFGH',
      expectedVersion: 3,
      smsChallengeId: 'sms-challenge',
      smsCode: '123456'
    },
    expect.objectContaining({
      headers: {
        Authorization: 'Bearer test-access-token',
        'Idempotency-Key': '11111111111141118111111111111111'
      }
    })
  ])
  api.request.mockResolvedValueOnce({ ...approval, runtimeRecordId: preview.challengeId })
  await expect(
    approveMobileRuntimeClaim(session, 'ABCD-EFGH', preview, sms, '123456')
  ).rejects.toThrow()
})

it('does not issue SMS or approve an expired or invalid version of the reviewed claim', async () => {
  const expired = { ...preview, expiresAt: new Date(0).toISOString() }
  await expect(startMobileRuntimeClaimSms(session, 'ABCD-EFGH', expired)).rejects.toThrow()
  const sms = {
    challengeId: 'sms-challenge',
    expiresInSeconds: 120,
    resendAfterSeconds: 60,
    phoneNumberMasked: 'masked'
  }
  await expect(
    approveMobileRuntimeClaim(session, 'ABCD-EFGH', expired, sms, '123456')
  ).rejects.toThrow()
  await expect(
    approveMobileRuntimeClaim(session, 'ABCD-EFGH', preview, sms, 'bad')
  ).rejects.toThrow()
  expect(api.request).not.toHaveBeenCalled()
})
