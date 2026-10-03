import { expect, it, vi } from 'vitest'
import { HiveRuntimeCloudAccountClient } from './hive-runtime-cloud-account-client'
const identity = {
  contract: 'hive-runtime-local-identity-v1',
  accountId: '11111111-1111-4111-8111-111111111111',
  deviceId: '22222222-2222-4222-8222-222222222222',
  authorityId: 'authority',
  expiresAt: Date.now() + 60_000
}
it('reads current identity at the fixed Hive endpoint without sending identity overrides', async () => {
  const fetch = vi.fn(async () => Response.json(identity))
  const client = new HiveRuntimeCloudAccountClient('https://cloud.example.test', fetch)
  const result = await client.getCurrentIdentity('private-credential')
  expect(result).toEqual(identity)
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0]).toMatchObject([
    'https://cloud.example.test/hive/v1/ai/identity',
    { method: 'GET', redirect: 'error' }
  ])
  expect(JSON.stringify(result)).not.toContain('private-credential')
})
it.each([
  { ...identity, deviceId: 'made-up-device' },
  { ...identity, accountId: 'wrong-account' },
  { ...identity, contract: 'hive-ai-inference-grant/v1' },
  { ...identity, expiresAt: Number.MAX_SAFE_INTEGER + 1 },
  { ...identity, accessToken: 'unexpected-secret' }
])('refuses malformed or unrelated identity responses', async (value) => {
  const client = new HiveRuntimeCloudAccountClient('https://cloud.example.test', async () =>
    Response.json(value)
  )
  await expect(client.getCurrentIdentity('private-credential')).rejects.toThrow()
})
it('rejects missing, injected or cancelled credentials before calling HTTP', async () => {
  const fetch = vi.fn(async () => Response.json(identity))
  const client = new HiveRuntimeCloudAccountClient('https://cloud.example.test', fetch)
  for (const token of ['', 'token\r\nInjected', 'x'.repeat(8193)]) {
    await expect(client.getCurrentIdentity(token)).rejects.toThrow(
      'hive_agent_identity_unavailable'
    )
  }
  await expect(
    client.getCurrentIdentity('private-credential', AbortSignal.abort())
  ).rejects.toThrow()
  expect(fetch).not.toHaveBeenCalled()
})
it('does not retry or turn a rejected credential into local identity', async () => {
  const fetch = vi.fn(async () => Response.json({ code: 'CREDENTIAL_REJECTED' }, { status: 401 }))
  const client = new HiveRuntimeCloudAccountClient('https://cloud.example.test', fetch)
  await expect(client.getCurrentIdentity('private-credential')).rejects.toThrow()
  expect(fetch).toHaveBeenCalledOnce()
})
