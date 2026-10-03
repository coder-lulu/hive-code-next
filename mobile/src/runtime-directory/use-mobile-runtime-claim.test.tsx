import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { MobileApiError } from '../auth/mobile-sms-client'
import { useMobileRuntimeClaim } from './use-mobile-runtime-claim'

const api = vi.hoisted(() => ({ preview: vi.fn(), sms: vi.fn(), approve: vi.fn() }))
vi.mock('../auth/mobile-sms-client', () => ({
  MobileApiError: class extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly category?: string,
      readonly retryable = false,
      readonly retryAfterMs: number | null = null
    ) {
      super(message)
    }
  }
}))
vi.mock('./mobile-runtime-claim-client', () => ({
  previewMobileRuntimeClaim: api.preview,
  startMobileRuntimeClaimSms: api.sms,
  approveMobileRuntimeClaim: api.approve,
  normalizeMobileRuntimeClaimCode: (value: string) => {
    if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(value)) {
      throw new Error('invalid-code')
    }
    return value
  }
}))
const session = {
  accessToken: 'test-token',
  account: { accountId: 'account-a' },
  authorityId: 'cloud'
} as MobileSession
let claim!: ReturnType<typeof useMobileRuntimeClaim>
let renderer: ReactTestRenderer | null = null
function Probe({ scope = 'a' }: { scope?: string }) {
  claim = useMobileRuntimeClaim({ ...session, account: { ...session.account, accountId: scope } })
  return null
}
async function reviewAndSend() {
  act(() => claim.setCode('ABCD-EFGH'))
  await act(async () => claim.review())
  await act(async () => claim.sendSms())
  act(() => claim.setSmsCode('123456'))
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-14T05:00:00Z'))
  vi.clearAllMocks()
  api.preview.mockResolvedValue({
    challengeId: 'claim-a',
    runtimeRecordId: 'runtime-a',
    expectedVersion: 3,
    expiresAt: new Date(Date.now() + 300_000).toISOString()
  })
  api.sms.mockResolvedValue({
    challengeId: 'sms-a',
    expiresInSeconds: 120,
    resendAfterSeconds: 60,
    phoneNumberMasked: 'masked'
  })
  api.approve.mockResolvedValue({ status: 'APPROVED' })
  act(() => {
    renderer = create(createElement(Probe, { key: 'a' }))
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  vi.useRealTimers()
})

it('requires review and SMS, prevents double approval and clears proof after approval', async () => {
  await act(async () => claim.confirm())
  expect(api.approve).not.toHaveBeenCalled()
  await reviewAndSend()
  await act(async () => {
    await Promise.all([claim.confirm(), claim.confirm()])
  })
  expect(api.approve).toHaveBeenCalledOnce()
  expect(claim.approved).toBe(true)
  expect(claim.smsCode).toBe('')
  expect(claim.sms).toBeNull()
})

it('respects SMS resend cooldown and expiry without submitting expired proof', async () => {
  await reviewAndSend()
  await act(async () => claim.sendSms())
  expect(api.sms).toHaveBeenCalledOnce()
  act(() => vi.advanceTimersByTime(121_000))
  expect(claim.smsExpired).toBe(true)
  await act(async () => claim.confirm())
  expect(api.approve).not.toHaveBeenCalled()
  await act(async () => claim.sendSms())
  expect(api.sms).toHaveBeenCalledTimes(2)
})

it('treats timeout after approval as uncertain and blocks replay without claiming success', async () => {
  await reviewAndSend()
  api.approve.mockRejectedValue(new MobileApiError('timeout', 408, undefined, true))
  await act(async () => claim.confirm())
  expect(claim.uncertain).toBe(true)
  expect(claim.approved).toBe(false)
  await act(async () => claim.confirm())
  expect(api.approve).toHaveBeenCalledOnce()
})

it('requires matching account and reauthentication on rejected sessions', async () => {
  act(() => claim.setCode('ABCD-EFGH'))
  api.preview.mockRejectedValueOnce(
    new MobileApiError('wrong-account', 403, 'runtime_claim_account_mismatch')
  )
  await act(async () => claim.review())
  expect(claim.error).toContain('同一 HiveCloud 账号')
  api.preview.mockRejectedValueOnce(new MobileApiError('expired', 401))
  await act(async () => claim.review())
  expect(claim.requiresLogin).toBe(true)
  await act(async () => claim.review())
  expect(api.preview).toHaveBeenCalledTimes(2)
})

it('aborts pending work and discards the old account response when the account changes', async () => {
  let resolve!: (value: unknown) => void
  api.preview.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  act(() => claim.setCode('ABCD-EFGH'))
  let pending!: Promise<void>
  act(() => {
    pending = claim.review()
  })
  const signal = api.preview.mock.calls[0][2] as AbortSignal
  act(() => renderer!.update(createElement(Probe, { key: 'b', scope: 'b' })))
  expect(signal.aborted).toBe(true)
  await act(async () => {
    resolve({ runtimeRecordId: 'old-account-runtime' })
    await pending
  })
  expect(claim.preview).toBeNull()
  expect(claim.busy).toBe(false)
  expect(claim.code).toBe('')
})
