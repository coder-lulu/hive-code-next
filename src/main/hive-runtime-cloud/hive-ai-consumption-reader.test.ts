import { afterEach, expect, it, vi } from 'vitest'
import { HiveAiConsumptionClient, HiveAiConsumptionReader } from './hive-ai-consumption-reader'
import {
  consumptionQueryFixture as query,
  consumptionPageFixture as page
} from '../../shared/hive-ai-consumption.test-fixture'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'

function fixture() {
  let auth: HiveRuntimeCloudAuthorization | null = {
    accessToken: 'secret',
    accountId: 'owner',
    authorityId: 'authority',
    sessionExpiresAt: Date.now() + 60000,
    sessionGeneration: 1
  }
  const listeners = new Set<() => void>()
  const history = vi.fn().mockResolvedValue(page)
  const reader = new HiveAiConsumptionReader(
    {
      getRuntimeCloudAuthorization: () => auth,
      subscribeRuntimeCloudAuthorization: (listener) => {
        const notify = () => listener(auth)
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
    () => ({ history })
  )
  return {
    reader,
    history,
    listeners,
    logout: () => {
      auth = null
      listeners.forEach((listener) => listener())
    }
  }
}
afterEach(() => vi.useRealTimers())
it('reads only through the current Hive identity', async () => {
  const f = fixture()
  expect(await f.reader.read(query)).toEqual({ accountId: 'owner', history: page })
  expect(f.history).toHaveBeenCalledWith('secret', query, expect.any(AbortSignal))
  expect(f.listeners.size).toBe(0)
})
it('aborts superseded queries without coalescing different pages', async () => {
  const f = fixture()
  f.history.mockImplementationOnce(() => new Promise(() => undefined))
  const first = expect(f.reader.read(query)).rejects.toThrow('unavailable')
  await f.reader.read({ ...query, page: 2 })
  await first
  expect(f.history.mock.calls[0][2].aborted).toBe(true)
  expect(f.history.mock.calls[1][1].page).toBe(2)
})
it('rejects a hanging transport immediately on logout and after deadline', async () => {
  vi.useFakeTimers()
  const f = fixture()
  f.history.mockImplementation(() => new Promise(() => undefined))
  const pending = expect(f.reader.read(query)).rejects.toThrow('unavailable')
  await vi.advanceTimersByTimeAsync(15000)
  await pending
  expect(f.listeners.size).toBe(0)
  const next = expect(f.reader.read(query)).rejects.toThrow('unavailable')
  f.logout()
  await next
  expect(f.listeners.size).toBe(0)
})
it('uses a bounded non-retrying GET and validates returned query and integer precision', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(page), { headers: { 'content-type': 'application/json' } })
    )
  const client = new HiveAiConsumptionClient('https://cloud.example.test', fetcher)
  expect(
    (await client.history('secret', query, new AbortController().signal)).entries[0].recordedPoints
  ).toBe('9007199254740993')
  expect(fetcher).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls[0][0]).toContain('/hive/v1/ai/consumption?')
  expect(fetcher.mock.calls[0][1].headers.authorization).toBe('Bearer secret')
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ ...page, page: 2 }), {
      headers: { 'content-type': 'application/json' }
    })
  )
  await expect(client.history('secret', query, new AbortController().signal)).rejects.toThrow(
    'invalid_ai_consumption'
  )
})
