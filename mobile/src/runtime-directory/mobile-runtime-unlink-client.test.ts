import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { MobileApiError, mobileApiUrl } from '../auth/mobile-sms-client'
import { requestMobileRuntimeUnlinkSms, unlinkMobileRuntime } from './mobile-runtime-unlink-client'

vi.mock('expo-crypto', () => ({}))
vi.mock('expo-secure-store', () => ({}))

const session: MobileSession = {
  accessToken: 'unlink-access-token',
  refreshToken: 'unused-refresh-token',
  authorityId: 'cloud',
  account: { accountId: 'account-a', displayName: 'Account A' },
  expiresAt: 2_000_000_000_000,
  sessionExpiresAt: 2_100_000_000_000,
  sessionProfile: 'TRUSTED'
}
const target = { runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', resourceVersion: 3 }
const proof = { smsChallengeId: '0123456789abcdef0123456789abcdef', smsCode: '012345' }
const challenge = {
  challengeId: proof.smsChallengeId,
  phoneNumberMasked: '+86 138****0000',
  expiresInSeconds: 300,
  resendAfterSeconds: 0
}
const result = {
  runtimeRecordId: target.runtimeRecordId,
  status: 'UNLINKED',
  authorityGeneration: 2,
  fencingEpoch: 4,
  resourceVersion: 5,
  unlinkedAt: '2026-10-17T01:02:03Z'
}
const fetchMock = vi.fn<typeof fetch>()
const respond = (value: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  )

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

it('sends exact SMS and unlink bodies directly with bearer authentication and no cookies', async () => {
  respond({ code: 200, data: challenge })
  respond(result)
  await expect(requestMobileRuntimeUnlinkSms(session, target)).resolves.toEqual(challenge)
  await expect(unlinkMobileRuntime(session, target, proof)).resolves.toEqual(result)
  const basePath = `/hive/v1/runtimes/${target.runtimeRecordId}/unlink`
  for (const [index, path, body] of [
    [0, `${basePath}/sms-challenges`, { expectedVersion: 3 }],
    [1, basePath, { expectedVersion: 3, ...proof }]
  ] as const) {
    const [url, init] = fetchMock.mock.calls[index]!
    expect(url).toBe(mobileApiUrl(path))
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer unlink-access-token'
      }
    })
    expect(typeof init?.body).toBe('string')
    expect(JSON.parse(String(init?.body))).toEqual(body)
    expect(init!.headers).not.toHaveProperty('Idempotency-Key')
  }
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it.each([
  { ...target, runtimeRecordId: '../another-runtime' },
  { ...target, runtimeRecordId: target.runtimeRecordId.toUpperCase() },
  ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN].map((resourceVersion) => ({
    ...target,
    resourceVersion
  }))
])('rejects an invalid target before either request: %j', async (invalid) => {
  await expect(requestMobileRuntimeUnlinkSms(session, invalid)).rejects.toThrow()
  await expect(unlinkMobileRuntime(session, invalid, proof)).rejects.toThrow()
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  { ...proof, smsChallengeId: 'not-a-challenge' },
  { ...proof, smsChallengeId: proof.smsChallengeId.toUpperCase() },
  ...['12345', '1234567', '１２３４５６', ' 123456', '12345a'].map((smsCode) => ({
    ...proof,
    smsCode
  }))
])('rejects invalid proof before sending: %j', async (invalid) => {
  await expect(unlinkMobileRuntime(session, target, invalid)).rejects.toThrow()
  expect(fetchMock).not.toHaveBeenCalled()
})

it.each([
  null,
  {},
  { ...challenge, challengeId: 'a'.repeat(31) },
  { ...challenge, challengeId: 'A'.repeat(32) },
  { ...challenge, phoneNumberMasked: ' ' },
  { ...challenge, expiresInSeconds: 0 },
  { ...challenge, expiresInSeconds: 1.5 },
  { ...challenge, resendAfterSeconds: -1 },
  { ...challenge, resendAfterSeconds: 0.5 }
])('rejects malformed SMS responses without retry: %j', async (invalid) => {
  respond(invalid)
  await expect(requestMobileRuntimeUnlinkSms(session, target)).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it.each([
  null,
  {},
  { ...result, status: 'CLAIMED' },
  { ...result, runtimeRecordId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { ...result, resourceVersion: 3 },
  { ...result, resourceVersion: 2 },
  { ...result, authorityGeneration: 0 },
  { ...result, fencingEpoch: 1.5 },
  { ...result, resourceVersion: Number.MAX_SAFE_INTEGER + 1 },
  { ...result, unlinkedAt: 'not-a-timestamp' },
  { ...result, unlinkedAt: '2026-02-30T01:02:03Z' }
])('rejects invalid unlink acknowledgements without retry: %j', async (invalid) => {
  respond(invalid)
  await expect(unlinkMobileRuntime(session, target, proof)).rejects.toThrow()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

describe.each([
  ['SMS', (signal?: AbortSignal) => requestMobileRuntimeUnlinkSms(session, target, signal)],
  ['unlink', (signal?: AbortSignal) => unlinkMobileRuntime(session, target, proof, signal)]
] as const)('%s failure handling', (_name, perform) => {
  it.each([409, 429, 503])(
    'never retries API errors, including retryable status %s',
    async (status) => {
      respond({ category: 'runtime_unavailable', msg: 'unavailable' }, status)
      await expect(perform()).rejects.toMatchObject({ name: 'MobileApiError', status })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('never retries a transport failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network disconnected'))
    await expect(perform()).rejects.toBeInstanceOf(MobileApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not send a request with an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(perform(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards in-flight cancellation and does not retry', async () => {
    const controller = new AbortController()
    const failure = new DOMException('cancelled', 'AbortError')
    fetchMock.mockImplementationOnce(async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(failure), { once: true })
        controller.abort()
        expect(init!.signal!.aborted).toBe(true)
      })
    })
    await expect(perform(controller.signal)).rejects.toBe(failure)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
