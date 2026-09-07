import { createHash, createPublicKey, generateKeyPairSync, randomUUID, verify } from 'node:crypto'
import nacl from 'tweetnacl'
import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))
import { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import { HiveRuntimeRelayAuthorizationProvider } from './hive-runtime-relay-authorization-provider'
import { hiveRuntimeRelayTupleHash } from './hive-runtime-relay-credential-binding'
import type { CurrentHiveRuntimeCloudLeaseContext } from '../hive-runtime-cloud-lease-context'
import type { HiveRuntimeRelayHostBinding } from './hive-runtime-relay-types'

function fixture() {
  const keys = generateKeyPairSync('ed25519')
  const runtimeInstanceId = randomUUID()
  const context: CurrentHiveRuntimeCloudLeaseContext = {
    authorityId: 'hive-cloud',
    identity: {
      schemaVersion: 1,
      runtimeInstanceId,
      privateKeyPkcs8: keys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      publicKey: keys.publicKey.export({ format: 'jwk' }).x!,
      createdAt: Date.now()
    },
    tuple: {
      runtimeRecordId: randomUUID(),
      runtimeInstanceId,
      bootId: randomUUID(),
      heartbeatLeaseId: randomUUID(),
      authorityGeneration: 1,
      fencingEpoch: 2,
      leaseEpoch: 3
    }
  }
  const raw = nacl.box.keyPair()
  const keypair = { ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }
  const hostKeyHash = createHash('sha256').update(raw.publicKey).digest('base64url')
  const now = Math.floor(Date.now() / 1000) * 1000
  const assignment = {
    protocolVersion: 2,
    cellUrl: 'https://relay.hivekernel.com',
    cellId: 'cell-1',
    cellIncarnationId: randomUUID(),
    assignmentId: randomUUID(),
    assignmentEpoch: 2,
    relayHostId: hostKeyHash.slice(0, 16),
    controlLease: '',
    controlLeaseExpiresAt: now + 120_000
  }
  const claims = {
    iss: 'https://api.hivekernel.com',
    sub: runtimeInstanceId,
    aud: 'hive-relay-cell',
    scope: 'relay:control',
    jti: randomUUID(),
    iat: now / 1000,
    nbf: now / 1000,
    exp: now / 1000 + 120,
    cellId: assignment.cellId,
    cellIncarnationId: assignment.cellIncarnationId,
    assignmentId: assignment.assignmentId,
    relayHostId: assignment.relayHostId,
    hostKeyHash,
    runtimeTupleHash: hiveRuntimeRelayTupleHash(context),
    authorityGeneration: 1,
    fencingEpoch: 2,
    leaseEpoch: 3,
    assignmentEpoch: 2,
    controlGeneration: 7
  }
  function token() {
    assignment.controlLease = [
      Buffer.from(
        JSON.stringify({ alg: 'EdDSA', typ: 'relay-control+jwt', kid: 'key-1' })
      ).toString('base64url'),
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      Buffer.alloc(64, 1).toString('base64url')
    ].join('.')
  }
  token()
  let binding: HiveRuntimeRelayHostBinding | null = null
  const beforeKeyRotation = vi.fn()
  let current: CurrentHiveRuntimeCloudLeaseContext | null = context
  const requests: { url: string; body: Record<string, unknown>; init: RequestInit }[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    requests.push({ url, body, init })
    const response = url.endsWith('/runtime-relay-hosts')
      ? {
          protocolVersion: 2,
          relayHostId: assignment.relayHostId,
          hostBindingVersion: Number(body.expectedBindingVersion) + 1
        }
      : url.endsWith('/relay/authorizations')
        ? { protocolVersion: 2, relayToken: 'header.director.signature', expiresAt: now + 300_000 }
        : assignment
    return new Response(JSON.stringify(response), { status: 200 })
  })
  const provider = new HiveRuntimeRelayAuthorizationProvider({
    client: new HiveRuntimeRelayCloudClient('https://api.hivekernel.com', fetch),
    currentLeaseContext: () => current,
    requestedRegion: 'cn',
    now: () => now,
    bindingStore: {
      read: () => binding,
      write: (_, value) => {
        binding = value
      }
    },
    beforeKeyRotation
  })
  return {
    provider,
    context,
    keypair,
    requests,
    claims,
    token,
    fetch,
    keys,
    beforeKeyRotation,
    setBinding: (value: HiveRuntimeRelayHostBinding) => {
      binding = value
    },
    setCurrent: (value: typeof current) => {
      current = value
    }
  }
}

describe('Hive Runtime Relay authorization boundary', () => {
  it('refreshes the current owner through expiry CAS without a Director token or generation takeover', async () => {
    const f = fixture()
    const original = await f.provider.resolve(f)
    const refreshed = await f.provider.refresh(original)
    expect(refreshed.controlGeneration).toBe(original.controlGeneration)
    expect(f.requests.at(-1)?.url).toBe(
      `https://api.hivekernel.com/hive/v1/runtimes/${f.context.tuple.runtimeRecordId}/relay/control-leases/refresh`
    )
    expect(f.requests.at(-1)?.body.expectedControlLeaseExpiresAt).toBe(
      original.controlLeaseExpiresAt
    )
    expect(
      (f.requests.at(-1)?.init.headers as Record<string, string> | undefined)?.authorization
    ).toBeUndefined()
    f.claims.controlGeneration++
    f.token()
    await expect(f.provider.refresh(original)).rejects.toThrow('refresh_binding_mismatch')
  })
  it('pauses the old Host before rotating through the stored CAS version', async () => {
    const f = fixture()
    f.setBinding({
      relayHostId: 'old-host-binding',
      hostBindingVersion: 4,
      hostPublicKeyB64: 'old-key'
    })
    const result = await f.provider.resolve(f)
    expect(f.beforeKeyRotation).toHaveBeenCalledOnce()
    expect(f.requests[0].body.expectedBindingVersion).toBe(4)
    expect(result.binding.hostBindingVersion).toBe(5)
  })

  it.each([
    'http://relay.example.com',
    'https://RELAY.example.com',
    'https://relay.example.com:443',
    'https://127.0.0.1',
    'https://relay.example.com/path'
  ])('rejects noncanonical assignment origin %s', async (cellUrl) => {
    const f = fixture()
    const original = f.fetch.getMockImplementation()!
    f.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (!url.endsWith('/assign')) {
        return response
      }
      return new Response(JSON.stringify({ ...(await response.json()), cellUrl }), { status: 200 })
    })
    await expect(f.provider.resolve(f)).rejects.toThrow('invalid_hive_runtime_relay_response')
  })
  it('binds the X25519 key and exact tuple, sends the Director token only to assign, and obtains the signed generation', async () => {
    const f = fixture()
    const assignment = await f.provider.resolve(f)
    expect(assignment.controlGeneration).toBe(7)
    expect(f.requests.map((r) => r.url)).toEqual([
      'https://api.hivekernel.com/hive/v1/runtime-relay-hosts',
      `https://api.hivekernel.com/hive/v1/runtimes/${f.context.tuple.runtimeRecordId}/relay/authorizations`,
      'https://api.hivekernel.com/v1/assign'
    ])
    const { runtimeProof, ...body } = f.requests[0].body
    const { signature, ...proof } = runtimeProof as Record<string, string>
    expect(proof.runtimeId).toBe(f.context.tuple.runtimeInstanceId)
    expect(
      verify(
        null,
        Buffer.from(Object.values(proof).join('\n')),
        createPublicKey(f.keys.privateKey),
        Buffer.from(signature, 'base64url')
      )
    ).toBe(true)
    expect(body.expectedBindingVersion).toBe(0)
    expect((f.requests[0].init.headers as Record<string, string>).authorization).toBeUndefined()
    expect((f.requests[2].init.headers as Record<string, string>).authorization).toBe(
      'Bearer header.director.signature'
    )
    expect(JSON.stringify(assignment)).not.toContain('header.director.signature')
  })

  it.each([
    'cellId',
    'cellIncarnationId',
    'assignmentId',
    'runtimeTupleHash',
    'hostKeyHash',
    'assignmentEpoch',
    'controlGeneration',
    'exp'
  ])('rejects invalid claim %s before returning a usable control lease', async (field) => {
    const f = fixture()
    Object.assign(f.claims, { [field]: field === 'controlGeneration' ? -1 : 'wrong' })
    f.token()
    await expect(f.provider.resolve(f)).rejects.toThrow('credential_binding_rejected')
  })

  it.each(['authorityGeneration', 'fencingEpoch', 'leaseEpoch', 'assignmentEpoch'] as const)(
    'rejects a stale numeric %s even when the tuple hash and other bindings match',
    async (field) => {
      const f = fixture()
      f.claims[field]--
      f.token()
      await expect(f.provider.resolve(f)).rejects.toThrow('credential_binding_rejected')
    }
  )

  it('stops the chain after a late binding response observes a fenced tuple', async () => {
    const f = fixture()
    const original = f.fetch.getMockImplementation()!
    f.fetch.mockImplementationOnce(async (url, init) => {
      const response = await original(url, init)
      f.setCurrent(null)
      return response
    })
    await expect(f.provider.resolve(f)).rejects.toThrow('stale_tuple')
    expect(f.requests).toHaveLength(1)
  })

  it('bounds 20 concurrent authorizations to one network chain', async () => {
    const f = fixture()
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => f.provider.resolve(f))
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(rejected).toHaveLength(19)
    for (const result of rejected) {
      expect(result.reason.message).toContain('in_progress')
    }
    expect(f.requests).toHaveLength(3)
  })
})
