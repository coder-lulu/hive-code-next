import { generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { HiveAiTextGrantClient } from './hive-ai-text-grant-client'
import { grantCommand } from '../../shared/hive-ai-text-grant.test-fixture'
import { parseHiveAiTextGrantRequest } from '../../shared/hive-ai-text-grant-request'
import { controlOwner } from '../../shared/hive-ai-text-control.test-fixture'
import { canonicalHiveAiTextRequest } from '../../shared/hive-ai-text-request'
import { sha256 } from './hive-runtime-cloud-proof-core'

const key = generateKeyPairSync('ed25519')
const input = () => ({
  command: parseHiveAiTextGrantRequest(grantCommand),
  owner: { ...controlOwner },
  identity: {
    schemaVersion: 1 as const,
    runtimeInstanceId: grantCommand.runtime.runtimeInstanceId,
    privateKeyPkcs8: key.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: key.publicKey
      .export({ type: 'spki', format: 'der' })
      .subarray(-32)
      .toString('base64url'),
    createdAt: 1
  },
  authorityId: 'authority',
  accessToken: 'native-secret-token',
  assertCurrent: () => {}
})
function reply() {
  const { messages: _, ...content } = grantCommand.request
  return {
    requestId: content.requestId,
    grant: {
      claims: {
        domain: 'hive-ai-text-grant/v1',
        issuer: 'hive-ai-authority',
        audience: 'hive-ai-edge',
        authorityId: 'authority',
        algorithm: 'Ed25519',
        grant: {
          grantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          owner: { ...controlOwner },
          binding: {
            ...content,
            runtime: { ...grantCommand.runtime },
            projectScope: grantCommand.projectScope,
            ...grantCommand.pack,
            requestHash: sha256(canonicalHiveAiTextRequest(grantCommand.request)),
            credentialFence: 'c'.repeat(64),
            gatewayRevision: 1
          },
          eligibilityRevision: 1,
          nonce: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          issuedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString()
        }
      },
      signature: 'A'.repeat(86)
    }
  }
}
afterEach(() => vi.useRealTimers())
it('rejects a response that arrives after the HTTP deadline even if transport ignores abort', async () => {
  vi.useFakeTimers()
  const value = reply()
  const fetcher = vi.fn(async () => {
    await vi.advanceTimersByTimeAsync(10001)
    return Response.json(value)
  })
  await expect(
    new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(input())
  ).rejects.toThrow(/^hive_ai_grant_unavailable$/)
  expect(fetcher).toHaveBeenCalledOnce()
})
it('rejects a body that completes after the deadline', async () => {
  vi.useFakeTimers()
  const value = reply()
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(value)))
              controller.close()
            }, 11000)
          }
        })
      )
  )
  const checked = expect(
    new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(input())
  ).rejects.toThrow(/^hive_ai_grant_unavailable$/)
  await vi.advanceTimersByTimeAsync(11000)
  await checked
  expect(fetcher).toHaveBeenCalledOnce()
})
it('posts signed bytes once at the fixed origin and freezes the bound receipt', async () => {
  const value = reply()
  const fetcher = vi.fn().mockResolvedValue(Response.json(value))
  const grant = await new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(input())
  expect(grant).toEqual(value.grant)
  expect(
    [
      grant,
      grant.claims,
      grant.claims.grant,
      grant.claims.grant.owner,
      grant.claims.grant.binding
    ].every(Object.isFrozen)
  ).toBe(true)
  expect(fetcher).toHaveBeenCalledOnce()
  const [url, init] = fetcher.mock.calls[0]
  expect(url).toBe('https://cloud.test/hive/v1/ai/grants')
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
  expect(JSON.parse(init.body)).toEqual(grantCommand)
  const headers = new Headers(init.headers)
  expect(headers.get('authorization')).toBe('Bearer native-secret-token')
  expect(headers.has('cookie')).toBe(false)
  const proof = JSON.parse(Buffer.from(headers.get('X-Hive-AI-Proof')!, 'base64url').toString())
  expect(proof.bodySha256).toBe(sha256(init.body))
})
it.each([
  'requestId',
  'sessionId',
  'generationId',
  'modelId',
  'protocol',
  'snapshotRevision',
  'packRevision',
  'projectScope',
  'requestHash',
  'inputLimit',
  'outputLimit'
])('rejects mismatched binding %s', async (field) => {
  const value = reply()
  const binding = value.grant.claims.grant.binding as Record<string, unknown>
  binding[field] =
    typeof binding[field] === 'number' ? 1 : field === 'protocol' ? 'RESPONSES' : 'wrong'
  await expect(
    new HiveAiTextGrantClient('https://cloud.test', async () => Response.json(value)).issue(input())
  ).rejects.toThrow(/^hive_ai_grant_unavailable$/)
})
it.each([
  'authority',
  'owner',
  'runtime',
  'domain',
  'signature',
  'expired',
  'future',
  'lifetime',
  'extra'
])('rejects invalid receipt %s', async (scenario) => {
  const value = reply(),
    grant = value.grant.claims.grant
  if (scenario === 'authority') {
    value.grant.claims.authorityId = 'other'
  }
  if (scenario === 'owner') {
    grant.owner.accountId = grant.owner.deviceId
  }
  if (scenario === 'runtime') {
    grant.binding.runtime.fencingEpoch++
  }
  if (scenario === 'domain') {
    value.grant.claims.domain = 'relay'
  }
  if (scenario === 'signature') {
    value.grant.signature = `${'A'.repeat(85)}B`
  }
  if (scenario === 'expired') {
    grant.expiresAt = new Date(Date.now() - 100).toISOString()
  }
  if (scenario === 'future') {
    grant.issuedAt = new Date(Date.now() + 40000).toISOString()
  }
  if (scenario === 'lifetime') {
    grant.expiresAt = new Date(Date.now() + 200000).toISOString()
  }
  if (scenario === 'extra') {
    Object.assign(grant.binding, { apiKey: 'SECRET_CANARY' })
  }
  await expect(
    new HiveAiTextGrantClient('https://cloud.test', async () => Response.json(value)).issue(input())
  ).rejects.toThrow(/^hive_ai_grant_unavailable$/)
})
it.each([401, 403, 409, 429, 500, 503])(
  'never retries status %s or reflects server diagnostics',
  async (status) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 'SECRET_CANARY' }, { status }))
    await expect(
      new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(input())
    ).rejects.toMatchObject({ message: 'hive_ai_grant_request_failed', status, code: null })
    expect(fetcher).toHaveBeenCalledOnce()
  }
)
it('preserves explicit unavailable state for missing server cost authority', async () => {
  await expect(
    new HiveAiTextGrantClient('https://cloud.test', async () =>
      Response.json({ code: 'UNAVAILABLE' }, { status: 503 })
    ).issue(input())
  ).rejects.toMatchObject({ code: 'UNAVAILABLE', status: 503 })
})
it('rejects local credential/authorization/cancellation failures before HTTP', async () => {
  const fetcher = vi.fn(),
    client = new HiveAiTextGrantClient('https://cloud.test', fetcher)
  for (const patch of [
    { accessToken: '' },
    { accessToken: 'bad\ntoken' },
    { accessToken: 'a'.repeat(8193) },
    { signal: AbortSignal.abort() },
    {
      assertCurrent: () => {
        throw new Error('SECRET_CANARY')
      }
    }
  ]) {
    await expect(client.issue({ ...input(), ...patch })).rejects.toThrow(
      /^hive_ai_grant_unavailable$/
    )
  }
  expect(fetcher).not.toHaveBeenCalled()
})
it.each(['revoke', 'abort'])(
  'drops late %s despite replacement of caller options',
  async (mode) => {
    let revoked = false
    const abort = new AbortController()
    const options = {
      ...input(),
      signal: abort.signal,
      assertCurrent: () => {
        if (revoked) {
          throw new Error('SECRET_CANARY')
        }
      }
    }
    const fetcher = vi.fn(async () => {
      if (mode === 'revoke') {
        revoked = true
        options.assertCurrent = () => {}
      } else {
        abort.abort()
        options.signal = new AbortController().signal
      }
      return Response.json(reply())
    })
    await expect(
      new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(options)
    ).rejects.toThrow(/^hive_ai_grant_unavailable$/)
  }
)
it('pins originating owner and body while awaiting HTTP', async () => {
  const options = input()
  const fetcher = vi.fn(async () => {
    options.owner.accountId = options.owner.deviceId
    options.command = parseHiveAiTextGrantRequest({ ...grantCommand, projectScope: 'other' })
    options.authorityId = 'other'
    return Response.json(reply())
  })
  expect(
    (await new HiveAiTextGrantClient('https://cloud.test', fetcher).issue(options)).claims
      .authorityId
  ).toBe('authority')
})
