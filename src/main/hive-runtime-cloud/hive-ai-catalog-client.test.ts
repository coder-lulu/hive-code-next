import { createHash, generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HiveAiCatalogClient } from './hive-ai-catalog-client'

function fixture() {
  const keys = generateKeyPairSync('ed25519')
  const runtimeInstanceId = randomUUID()
  return {
    keys,
    input: {
      accountId: randomUUID(),
      deviceId: randomUUID(),
      accessToken: 'test-native-token',
      context: {
        authorityId: 'hive-primary',
        identity: {
          schemaVersion: 1 as const,
          runtimeInstanceId,
          privateKeyPkcs8: keys.privateKey
            .export({ type: 'pkcs8', format: 'der' })
            .toString('base64'),
          publicKey: keys.publicKey.export({ format: 'jwk' }).x!,
          createdAt: Date.now()
        },
        tuple: {
          authorityGeneration: 1,
          runtimeRecordId: randomUUID(),
          runtimeInstanceId,
          bootId: randomUUID(),
          heartbeatLeaseId: randomUUID(),
          leaseEpoch: 1,
          fencingEpoch: 1
        }
      }
    }
  }
}
const emptyCatalog = { catalogRevision: 1, models: [] }

describe('Hive AI catalog client', () => {
  it('signs the exact body with the AI domain and fresh nonce, not a Relay proof', async () => {
    const { keys, input } = fixture()
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json(emptyCatalog))
    const client = new HiveAiCatalogClient('https://api.example/', fetch)
    expect(await client.catalog(input)).toEqual(emptyCatalog)
    await client.catalog(input)
    const proofs: string[] = []
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe('https://api.example/hive/v1/ai/catalog')
      expect(init.redirect).toBe('error')
      expect(init.method).toBe('POST')
      const headers = new Headers(init.headers)
      expect(headers.get('authorization')).toBe('Bearer test-native-token')
      const encoded = headers.get('X-Hive-AI-Proof')!
      proofs.push(encoded)
      const { owner, signature, ...fields } = JSON.parse(
        Buffer.from(encoded, 'base64url').toString()
      )
      expect(fields.domain).toBe('hive-ai-synthetic-pop/v1')
      expect(fields.bodySha256).toBe(createHash('sha256').update(String(init.body)).digest('hex'))
      expect(owner).toEqual({
        accountId: input.accountId,
        deviceId: input.deviceId,
        runtimeRecordId: input.context.tuple.runtimeRecordId
      })
      const canonical = JSON.stringify(
        Object.fromEntries(
          Object.entries({ ...fields, ...owner }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      )
      expect(
        verify(null, Buffer.from(canonical), keys.publicKey, Buffer.from(signature, 'base64url'))
      ).toBe(true)
      expect(headers.has('cookie')).toBe(false)
    }
    expect(proofs[0]).not.toBe(proofs[1])
  })
  it.each([
    'http://api.example',
    'https://user:secret@api.example',
    'https://api.example/v1',
    'https://api.example/?key=secret'
  ])('rejects non-authority origin %s', (origin) => {
    expect(() => new HiveAiCatalogClient(origin)).toThrow('hive_ai_invalid_origin')
  })
  it('does not dispatch cancelled or mismatched identities', async () => {
    const { input } = fixture()
    const fetch = vi.fn()
    const client = new HiveAiCatalogClient('https://api.example', fetch)
    await expect(client.catalog({ ...input, signal: AbortSignal.abort() })).rejects.toThrow(
      'cancelled'
    )
    input.context.tuple.runtimeInstanceId = randomUUID()
    await expect(client.catalog(input)).rejects.toThrow('invalid_identity')
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([403, 409, 503])('does not retry HTTP %s or reflect provider errors', async (status) => {
    const fetch = vi.fn(async () => Response.json({ code: 'SECRET_CANARY' }, { status }))
    const client = new HiveAiCatalogClient('https://api.example', fetch)
    await expect(client.catalog(fixture().input)).rejects.toMatchObject({
      message: 'hive_ai_catalog_request_failed',
      status,
      code: null
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('rejects success envelopes and oversized responses', async () => {
    for (const response of [
      Response.json({ code: 404, data: null }),
      new Response('x', { headers: { 'content-length': '65537' } })
    ]) {
      const client = new HiveAiCatalogClient('https://api.example', async () => response)
      await expect(client.catalog(fixture().input)).rejects.toThrow()
    }
  })
})
