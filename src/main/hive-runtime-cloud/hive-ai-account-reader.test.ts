import { afterEach, describe, expect, it, vi } from 'vitest'
import { HiveAiAccountClient, HiveAiAccountReader } from './hive-ai-account-reader'
import { modelCandidatesFixture as catalog } from '../../shared/hive-ai-model-candidates.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import {
  aiBenefitsFixture as benefits,
  largeAiBenefitsFixture
} from '../../shared/hive-ai-benefits.test-fixture'

const account = {
  status: 'ACTIVE' as const,
  activationAvailable: false,
  asOf: '2026-09-13T00:00:00Z'
}
const balance = {
  accountStatus: 'ACTIVE' as const,
  availableQuota: '9007199254740993',
  usedQuota: '0',
  requestCount: '1',
  unit: 'POINTS' as const,
  freshness: 'CURRENT' as const,
  asOf: account.asOf
}

function fixture() {
  let authorization: HiveRuntimeCloudAuthorization | null = {
    accessToken: 'private-token',
    accountId: 'owner-a',
    authorityId: 'authority',
    sessionExpiresAt: Date.now() + 60_000,
    sessionGeneration: 1
  }
  const listeners = new Set<() => void>()
  const client = {
    activate: vi.fn().mockResolvedValue(account),
    benefits: vi.fn().mockResolvedValue(benefits),
    modelCandidates: vi.fn().mockResolvedValue(catalog),
    account: vi.fn().mockResolvedValue(account),
    balance: vi.fn().mockResolvedValue(balance)
  }
  const reader = new HiveAiAccountReader(
    {
      getRuntimeCloudAuthorization: () => authorization,
      subscribeRuntimeCloudAuthorization: (listener) => {
        const notify = () => listener(authorization)
        listeners.add(notify)
        return () => {
          listeners.delete(notify)
        }
      }
    },
    () => ({
      configured: true,
      config: {
        apiBaseUrl: 'https://cloud.example.test',
        userLoginUrl: '',
        identityIssuer: '',
        clientId: '',
        scope: ''
      }
    }),
    () => client
  )
  return {
    reader,
    client,
    listeners,
    replaceSession: (accountId = 'owner-a') => {
      authorization = {
        ...authorization!,
        accountId,
        sessionGeneration: 2,
        accessToken: 'replacement-token'
      }
      listeners.forEach((notify) => notify())
    },
    signOut: () => {
      authorization = null
      listeners.forEach((notify) => notify())
    }
  }
}

afterEach(() => vi.useRealTimers())

describe('desktop explicit AI activation', () => {
  it('coalesces a current-session activation without reading balance or supplying identity', async () => {
    const { reader, client, listeners } = fixture()
    const first = reader.activate()
    expect(reader.activate()).toBe(first)
    expect(await first).toEqual({ accountId: 'owner-a', account })
    expect(client.activate).toHaveBeenCalledOnce()
    expect(client.account).not.toHaveBeenCalled()
    expect(client.balance).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })
  it('uses a fixed empty JSON POST with only the main-process Hive credential', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(account)))
    const client = new HiveAiAccountClient('https://cloud.example.test', fetcher)
    expect(await client.activate('private-token', new AbortController().signal)).toEqual(account)
    expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/account/activate')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: undefined,
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer private-token'
      }
    })
    expect(JSON.stringify(account)).not.toContain('private-token')
  })
  it('does not retry a lost POST and permits only an independent state read afterward', async () => {
    const { reader, client } = fixture()
    client.activate.mockRejectedValue(new Error('private-token in lost response'))
    client.account.mockResolvedValue({ ...account, status: 'UNKNOWN' })
    await expect(reader.activate()).rejects.toThrow('hive_ai_account_unavailable')
    expect((await reader.read()).account.status).toBe('UNKNOWN')
    expect(client.activate).toHaveBeenCalledOnce()
    expect(client.balance).not.toHaveBeenCalled()
  })
  it('rejects a removed session and cancels in-flight activation', async () => {
    const { reader, client, signOut } = fixture()
    client.activate.mockReturnValueOnce(new Promise(() => {}))
    const pending = expect(reader.activate()).rejects.toThrow('hive_ai_account_unavailable')
    signOut()
    await pending
    expect(client.activate.mock.calls[0][1].aborted).toBe(true)
    await expect(reader.activate()).rejects.toThrow('hive_ai_account_unavailable')
    expect(client.activate).toHaveBeenCalledOnce()
  })
  it('fences a replaced account and allows activation only with the replacement credential', async () => {
    const { reader, client, replaceSession } = fixture()
    client.activate.mockReturnValueOnce(new Promise(() => {}))
    const pending = expect(reader.activate()).rejects.toThrow('hive_ai_account_unavailable')
    replaceSession('owner-b')
    await pending
    expect((await reader.activate()).accountId).toBe('owner-b')
    expect(client.activate.mock.calls[1][0]).toBe('replacement-token')
  })
  it('bounds a stalled POST without retrying even if the transport ignores cancellation', async () => {
    vi.useFakeTimers()
    const { reader, client, listeners } = fixture()
    client.activate.mockReturnValueOnce(new Promise(() => {}))
    const pending = expect(reader.activate()).rejects.toThrow('hive_ai_account_unavailable')
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(client.activate).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
describe('desktop AI account reads', () => {
  it('accepts a valid maximum-count benefits projection above 64 KiB', async () => {
    const body = JSON.stringify(largeAiBenefitsFixture)
    expect(Buffer.byteLength(body)).toBeGreaterThan(65_536)
    const client = new HiveAiAccountClient(
      'https://fixture.invalid',
      async () => new Response(body)
    )
    expect(await client.benefits('fixture-token', new AbortController().signal)).toEqual(
      largeAiBenefitsFixture
    )
  })
  it.each([false, true])(
    'rejects benefits above 128 KiB (declared length: %s)',
    async (declared) => {
      const body = JSON.stringify({ padding: 'x'.repeat(131_072) })
      const client = new HiveAiAccountClient(
        'https://fixture.invalid',
        async () =>
          new Response(body, {
            headers: declared ? { 'content-length': String(Buffer.byteLength(body)) } : {}
          })
      )
      await expect(client.benefits('fixture-token', new AbortController().signal)).rejects.toThrow(
        'hive_runtime_cloud_response_too_large'
      )
    }
  )
  it('reads benefits independently from a failed or stalled wallet and coalesces benefits only', async () => {
    const { reader, client, signOut } = fixture()
    client.balance
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(new Promise(() => {}))
    await expect(reader.read()).rejects.toThrow('hive_ai_account_unavailable')
    const first = reader.readBenefits()
    expect(reader.readBenefits()).toBe(first)
    expect(await first).toEqual({ accountId: 'owner-a', account, benefits })
    const wallet = reader.read()
    const rejection = expect(wallet).rejects.toThrow('hive_ai_account_unavailable')
    expect((await reader.readBenefits()).benefits).toEqual(benefits)
    const controller = client.balance.mock.calls[1][1]
    expect(controller.aborted).toBe(false)
    signOut()
    await rejection
    expect(controller.aborted).toBe(true)
  })
  it('does not query benefits for inactive accounts', async () => {
    const { reader, client } = fixture()
    client.account.mockResolvedValue({ ...account, status: 'NOT_PROVISIONED' })
    expect((await reader.readBenefits()).benefits).toBeNull()
    expect(client.benefits).not.toHaveBeenCalled()
  })
  it('rejects late benefits after session replacement and aborts their transport', async () => {
    const { reader, client, replaceSession } = fixture()
    client.benefits.mockReturnValueOnce(new Promise(() => {}))
    const pending = expect(reader.readBenefits()).rejects.toThrow('hive_ai_account_unavailable')
    await vi.waitFor(() => expect(client.benefits).toHaveBeenCalledOnce())
    replaceSession()
    await pending
    expect(client.benefits.mock.calls[0][1].aborted).toBe(true)
    expect((await reader.readBenefits()).benefits).toEqual(benefits)
  })
  it('coalesces concurrent reads and returns only the current owner snapshot', async () => {
    const { reader, client, listeners } = fixture()
    const first = reader.read()
    expect(reader.read()).toBe(first)
    expect(await first).toEqual({ accountId: 'owner-a', account, balance })
    expect(client.balance).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })
  it('does not request balances or provision unactivated accounts', async () => {
    const { reader, client } = fixture()
    client.account.mockResolvedValue({ ...account, status: 'NOT_PROVISIONED' })
    expect((await reader.read()).balance).toBeNull()
    expect(client.balance).not.toHaveBeenCalled()
  })
  it('cancels and rejects late results when the session is removed', async () => {
    const { reader, client, signOut } = fixture()
    let release!: (value: typeof balance) => void
    client.balance.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const result = reader.read()
    await vi.waitFor(() => expect(client.balance).toHaveBeenCalled())
    const rejected = expect(result).rejects.toThrow('hive_ai_account_unavailable')
    signOut()
    release(balance)
    await rejected
    expect(client.balance.mock.calls[0][1].aborted).toBe(true)
    await expect(reader.read()).rejects.toThrow('hive_ai_account_unavailable')
  })
  it('bounds a stalled transport even if it ignores abort', async () => {
    vi.useFakeTimers()
    const { reader, client, listeners } = fixture()
    client.account.mockReturnValue(new Promise(() => {}))
    const result = expect(reader.read()).rejects.toThrow('hive_ai_account_unavailable')
    await vi.advanceTimersByTimeAsync(15_000)
    await result
    expect(listeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses only fixed Cloud paths and rejects malformed balances without exposing credentials', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(balance)))
    const client = new HiveAiAccountClient('https://cloud.example.test', fetcher)
    expect(await client.balance('private-token', new AbortController().signal)).toEqual(balance)
    expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/balance')
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { authorization: 'Bearer private-token' }
    })
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ ...balance, availableQuota: 9007199254740992 }))
    )
    await expect(client.balance('private-token', new AbortController().signal)).rejects.toThrow(
      'invalid_ai_account_response'
    )
  })
})

it('reads candidate prices independently from account activation and coalesces only the same query', async () => {
  const { reader, client } = fixture()
  client.account.mockResolvedValue({ ...account, status: 'NOT_PROVISIONED' })
  const first = reader.readModelCandidates()
  expect(reader.readModelCandidates()).toBe(first)
  expect(await first).toEqual({ accountId: 'owner-a', catalog })
  expect(client.account).not.toHaveBeenCalled()
  expect(client.balance).not.toHaveBeenCalled()
  expect(client.modelCandidates).toHaveBeenCalledOnce()
})
it('discards candidate responses from a replaced session and permits a new read', async () => {
  const { reader, client, replaceSession, listeners } = fixture()
  client.modelCandidates.mockReturnValueOnce(new Promise(() => {}))
  const pending = expect(reader.readModelCandidates()).rejects.toThrow(
    'hive_ai_account_unavailable'
  )
  replaceSession()
  await pending
  expect(client.modelCandidates.mock.calls[0][1].aborted).toBe(true)
  expect(await reader.readModelCandidates()).toEqual({ accountId: 'owner-a', catalog })
  expect(client.modelCandidates.mock.calls[1][0]).toBe('replacement-token')
  expect(listeners.size).toBe(0)
})
it('bounds stalled model discovery without retry or retaining auth subscriptions', async () => {
  vi.useFakeTimers()
  const { reader, client, listeners } = fixture()
  client.modelCandidates.mockReturnValue(new Promise(() => {}))
  const pending = expect(reader.readModelCandidates()).rejects.toThrow(
    'hive_ai_account_unavailable'
  )
  await vi.advanceTimersByTimeAsync(15_000)
  await pending
  expect(client.modelCandidates).toHaveBeenCalledOnce()
  expect(listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})
it('queries only the authenticated Cloud candidate endpoint and rejects oversized responses', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(catalog)))
  const client = new HiveAiAccountClient('https://cloud.example.test', fetcher)
  expect(await client.modelCandidates('private-token', new AbortController().signal)).toEqual(
    catalog
  )
  expect(fetcher.mock.calls[0][0]).toBe('https://cloud.example.test/hive/v1/ai/model-candidates')
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'GET',
    cache: 'no-store',
    redirect: 'error'
  })
  fetcher.mockResolvedValue(new Response(JSON.stringify({ padding: 'x'.repeat(65_536) })))
  await expect(
    client.modelCandidates('private-token', new AbortController().signal)
  ).rejects.toThrow('hive_runtime_cloud_response_too_large')
})
