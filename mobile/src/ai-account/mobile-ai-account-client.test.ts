import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readMobileAiConsumption } from './mobile-ai-consumption-client'
import {
  consumptionQueryFixture as consumptionQuery,
  consumptionPageFixture as consumptionPage
} from '../../../src/shared/hive-ai-consumption.test-fixture'
vi.mock('expo/fetch', () => ({
  fetch: (url: string, init: RequestInit) => globalThis.fetch(url, init)
}))
vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({}))
vi.mock('../generated/product-config', () => ({
  hivecodeProductConfig: { services: { api: { baseUrl: 'https://cloud.example.test' } } }
}))
import {
  activateMobileAiAccount,
  readMobileAiAccount,
  readMobileAiBenefits,
  readMobileAiModelCandidates
} from './mobile-ai-account-client'
import {
  aiBenefitsFixture as benefits,
  largeAiBenefitsFixture
} from '../../../src/shared/hive-ai-benefits.test-fixture'
import { MobileAiCloudUnauthorizedError } from './mobile-ai-cloud-error'
import { modelCandidatesFixture as catalog } from '../../../src/shared/hive-ai-model-candidates.test-fixture'
import type { MobileSession } from '../auth/mobile-sms-session'

const session: MobileSession = {
  accessToken: 'private-token',
  refreshToken: 'private-refresh',
  expiresAt: 4_000_000_000_000,
  sessionExpiresAt: 4_000_000_000_000,
  sessionProfile: 'TRUSTED',
  account: { accountId: 'owner', displayName: 'User' },
  authorityId: 'authority'
}
const account = { status: 'ACTIVE', activationAvailable: false, asOf: '2026-09-13T00:00:00Z' }
const balance = {
  accountStatus: 'ACTIVE',
  availableQuota: '9007199254740993',
  usedQuota: '0',
  requestCount: '1',
  unit: 'POINTS',
  freshness: 'CURRENT',
  asOf: account.asOf
}
const fetcher = vi.fn()
beforeEach(() => {
  fetcher.mockReset()
  vi.stubGlobal('fetch', fetcher)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('mobile Cloud AI account client', () => {
  it('reads consumption with Hive bearer, exact query and precise points', async () => {
    fetcher.mockResolvedValue(response(consumptionPage))
    const value = await readMobileAiConsumption(
      session,
      consumptionQuery,
      new AbortController().signal
    )
    expect(value.accountId).toBe('owner')
    expect(value.history.entries[0].recordedPoints).toBe('9007199254740993')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toContain('/hive/v1/ai/consumption?')
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer private-token')
  })
  it('rejects consumption identity injection and incorrect returned page', async () => {
    expect(() =>
      readMobileAiConsumption(
        session,
        { ...consumptionQuery, ownerId: 'other' } as never,
        new AbortController().signal
      )
    ).toThrow()
    expect(fetcher).not.toHaveBeenCalled()
    fetcher.mockResolvedValue(response({ ...consumptionPage, page: 2 }))
    await expect(
      readMobileAiConsumption(session, consumptionQuery, new AbortController().signal)
    ).rejects.toThrow('unavailable')
  })
  it('uses a fixed empty JSON activation POST without cookies, identity or gateway parameters', async () => {
    fetcher.mockResolvedValueOnce(response(account))
    expect(await activateMobileAiAccount(session, new AbortController().signal)).toEqual({
      accountId: 'owner',
      account
    })
    expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/account/activate')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: undefined,
      cache: 'no-store',
      redirect: 'error',
      credentials: 'omit',
      headers: { Authorization: 'Bearer private-token', 'Content-Type': 'application/json' }
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('does not retry a rejected or uncertain activation and sanitizes upstream details', async () => {
    fetcher.mockResolvedValueOnce(response({ message: 'private-refresh private-token' }, 503))
    await expect(activateMobileAiAccount(session, new AbortController().signal)).rejects.toThrow(
      'mobile_ai_cloud_unavailable'
    )
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('preserves session rejection for auth recovery without retrying the POST', async () => {
    fetcher.mockResolvedValueOnce(response({}, 401))
    await expect(
      activateMobileAiAccount(session, new AbortController().signal)
    ).rejects.toBeInstanceOf(MobileAiCloudUnauthorizedError)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects pre-cancelled or expired activation without a request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(activateMobileAiAccount(session, controller.signal)).rejects.toThrow(
      'mobile_ai_cloud_unavailable'
    )
    await expect(
      activateMobileAiAccount({ ...session, expiresAt: 0 }, new AbortController().signal)
    ).rejects.toThrow('mobile_ai_cloud_unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('bounds an unresponsive activation, cancels transport and never retries it', async () => {
    vi.useFakeTimers()
    fetcher.mockReturnValueOnce(new Promise(() => {}))
    const pending = expect(
      activateMobileAiAccount(session, new AbortController().signal)
    ).rejects.toThrow('mobile_ai_cloud_unavailable')
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('accepts a valid 100-plan benefits response above 64 KiB', async () => {
    expect(
      new TextEncoder().encode(JSON.stringify(largeAiBenefitsFixture)).byteLength
    ).toBeGreaterThan(65_536)
    fetcher
      .mockResolvedValueOnce(response(account))
      .mockResolvedValueOnce(response(largeAiBenefitsFixture))
    expect((await readMobileAiBenefits(session, new AbortController().signal)).benefits).toEqual(
      largeAiBenefitsFixture
    )
  })
  it.each([false, true])(
    'rejects benefits above 128 KiB (declared length: %s)',
    async (declared) => {
      const body = JSON.stringify({ padding: 'x'.repeat(131_072) })
      fetcher.mockResolvedValueOnce(response(account)).mockResolvedValueOnce(
        new Response(body, {
          headers: declared
            ? { 'content-length': String(new TextEncoder().encode(body).byteLength) }
            : {}
        })
      )
      await expect(readMobileAiBenefits(session, new AbortController().signal)).rejects.toThrow(
        'mobile_ai_cloud_unavailable'
      )
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  )
  it('reads benefits through fixed owner-only routes without a wallet request or exposed token', async () => {
    fetcher.mockResolvedValueOnce(response(account)).mockResolvedValueOnce(response(benefits))
    const result = await readMobileAiBenefits(session, new AbortController().signal)
    expect(result).toEqual({ accountId: 'owner', account, benefits })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://cloud.example.test/hive/v1/ai/account',
      'https://cloud.example.test/hive/v1/ai/benefits'
    ])
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: 'Bearer private-token' }
    })
    expect(JSON.stringify(result)).not.toContain('private-token')
  })
  it.each(['NOT_PROVISIONED', 'PENDING', 'UNKNOWN', 'DISABLED'])(
    'does not query benefits for %s',
    async (status) => {
      fetcher.mockResolvedValueOnce(response({ ...account, status }))
      expect(
        (await readMobileAiBenefits(session, new AbortController().signal)).benefits
      ).toBeNull()
      expect(fetcher).toHaveBeenCalledOnce()
    }
  )
  it('preserves authorization recovery when benefits reject a Hive session', async () => {
    fetcher.mockResolvedValueOnce(response(account)).mockResolvedValueOnce(response({}, 401))
    await expect(
      readMobileAiBenefits(session, new AbortController().signal)
    ).rejects.toBeInstanceOf(MobileAiCloudUnauthorizedError)
  })
  it('bounds stalled benefits and rejects them after page cancellation', async () => {
    fetcher.mockResolvedValueOnce(response(account)).mockReturnValueOnce(new Promise(() => {}))
    const controller = new AbortController()
    const pending = expect(readMobileAiBenefits(session, controller.signal)).rejects.toThrow(
      'mobile_ai_cloud_unavailable'
    )
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    controller.abort()
    await pending
    expect(fetcher.mock.calls[1][1].signal.aborted).toBe(true)
  })
  it('reads fixed Cloud routes with private Hive credentials and exact string amounts', async () => {
    fetcher.mockResolvedValueOnce(response(account)).mockResolvedValueOnce(response(balance))
    const result = await readMobileAiAccount(session, new AbortController().signal)
    expect(result).toEqual({ accountId: 'owner', account, balance })
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'https://cloud.example.test/hive/v1/ai/account',
      'https://cloud.example.test/hive/v1/ai/balance'
    ])
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: { Authorization: 'Bearer private-token' }
    })
    expect(JSON.stringify(result)).not.toContain('private-token')
  })
  it.each(['NOT_PROVISIONED', 'PENDING', 'UNKNOWN', 'DISABLED'])(
    'never provisions or reads balances for %s',
    async (status) => {
      fetcher.mockResolvedValue(response({ ...account, status }))
      expect((await readMobileAiAccount(session, new AbortController().signal)).balance).toBeNull()
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )
  it.each([
    response({ ...balance, availableQuota: 9007199254740992 }),
    response({ code: 'UNAVAILABLE' }, 503),
    response({ data: 'x'.repeat(65_536) })
  ])('rejects invalid or unavailable responses without exposing error bodies', async (invalid) => {
    fetcher.mockResolvedValueOnce(response(account)).mockResolvedValueOnce(invalid)
    await expect(readMobileAiAccount(session, new AbortController().signal)).rejects.toThrow(
      'mobile_ai_cloud_unavailable'
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('bounds a stalled read and cancels without retry', async () => {
    vi.useFakeTimers()
    fetcher.mockReturnValue(new Promise(() => {}))
    const pending = expect(
      readMobileAiAccount(session, new AbortController().signal)
    ).rejects.toThrow('mobile_ai_cloud_unavailable')
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it('does not dispatch with expired or already cancelled credentials', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(readMobileAiAccount(session, controller.signal)).rejects.toThrow(
      'mobile_ai_cloud_unavailable'
    )
    await expect(
      readMobileAiAccount({ ...session, expiresAt: 0 }, new AbortController().signal)
    ).rejects.toThrow('mobile_ai_cloud_unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

it('preserves only the unauthorized classification without leaking the server error', async () => {
  fetcher.mockResolvedValue(response({ msg: 'private upstream detail' }, 401))
  const failure = await readMobileAiAccount(session, new AbortController().signal).catch(
    (error) => error
  )
  expect(failure).toBeInstanceOf(MobileAiCloudUnauthorizedError)
  expect(failure.message).toBe('mobile_ai_cloud_unauthorized')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('reads model prices without account activation and never sends a gateway identity', async () => {
  fetcher.mockResolvedValue(response(catalog))
  expect(await readMobileAiModelCandidates(session, new AbortController().signal)).toEqual({
    accountId: 'owner',
    catalog
  })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/model-candidates')
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store'
  })
})
it.each([401, 503])(
  'classifies model read errors without leaking upstream data (%s)',
  async (status) => {
    fetcher.mockResolvedValue(response({ detail: 'private' }, status))
    const error = await readMobileAiModelCandidates(session, new AbortController().signal).catch(
      (e) => e
    )
    expect(error.message).toBe(
      status === 401 ? 'mobile_ai_cloud_unauthorized' : 'mobile_ai_cloud_unavailable'
    )
    expect(fetcher).toHaveBeenCalledOnce()
  }
)
it('cancels model discovery even when the fetch ignores abort', async () => {
  fetcher.mockReturnValue(new Promise(() => {}))
  const controller = new AbortController()
  const pending = expect(readMobileAiModelCandidates(session, controller.signal)).rejects.toThrow(
    'mobile_ai_cloud_unavailable'
  )
  controller.abort()
  await pending
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  expect(fetcher).toHaveBeenCalledOnce()
})
it('rejects malformed and oversized candidate responses', async () => {
  for (const raw of [{ ...catalog, scope: 'ACCOUNT' }, { padding: 'x'.repeat(65_536) }]) {
    fetcher.mockResolvedValue(response(raw))
    await expect(
      readMobileAiModelCandidates(session, new AbortController().signal)
    ).rejects.toThrow('mobile_ai_cloud_unavailable')
  }
})
