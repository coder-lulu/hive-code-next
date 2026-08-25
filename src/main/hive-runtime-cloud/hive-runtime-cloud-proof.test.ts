import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  canonicalRuntimeHeartbeatBody,
  createRuntimeHeartbeatRequest,
  createRuntimeLeaseAcquireRequest,
  createRuntimeRegistrationRequest
} from './hive-runtime-cloud-proof'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string }
const identity: HiveRuntimeCloudIdentity = {
  schemaVersion: 1,
  runtimeInstanceId: '123e4567-e89b-42d3-a456-426614174000',
  privateKeyPkcs8: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  publicKey: publicJwk.x,
  createdAt: 1
}
const context = {
  authorityId: 'hive-primary',
  issuedAt: '2026-08-25T08:00:00.000Z',
  nonce: '223e4567-e89b-42d3-a456-426614174000'
}

function verifies(input: string, signature: string): boolean {
  return verify(
    null,
    Buffer.from(input),
    createPublicKey({ key: publicKey.export({ format: 'jwk' }), format: 'jwk' }),
    Buffer.from(signature, 'base64url')
  )
}

describe('Hive Runtime Cloud proofs', () => {
  it('signs Registration with the frozen LF-joined field order', () => {
    const request = createRuntimeRegistrationRequest(
      identity,
      {
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        runtimeVersion: '1.4.178-rc.7',
        capabilities: ['pairing-v3', 'runtime-health-v1']
      },
      context
    )
    const input = [
      request.proof.protocolVersion,
      request.proof.algorithm,
      request.proof.method,
      request.proof.path,
      request.proof.authorityId,
      request.proof.issuedAt,
      request.proof.nonce,
      request.proof.bodySha256
    ].join('\n')

    expect(verifies(input, request.proof.signature)).toBe(true)
  })

  it('omits algorithm from the fixed-order Lease signature JSON', () => {
    const request = createRuntimeLeaseAcquireRequest(
      identity,
      {
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        expectedAuthorityGeneration: 3,
        expectedLeaseEpoch: 4,
        expectedFencingEpoch: 5
      },
      context
    )
    const input = JSON.stringify({
      protocolVersion: request.proof.protocolVersion,
      method: request.proof.method,
      path: request.proof.path,
      authorityId: request.proof.authorityId,
      bodySha256: request.proof.bodySha256,
      nonce: request.proof.nonce,
      issuedAt: request.proof.issuedAt
    })

    expect(input).not.toContain('algorithm')
    expect(verifies(input, request.proof.signature)).toBe(true)
  })

  it('recursively sorts the Heartbeat body and signature keys', () => {
    expect(canonicalRuntimeHeartbeatBody({ z: { b: 1, a: 2 }, a: [{ d: 3, c: 4 }] })).toBe(
      '{"a":[{"c":4,"d":3}],"z":{"a":2,"b":1}}'
    )
    const request = createRuntimeHeartbeatRequest(
      identity,
      {
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        leaseId: '423e4567-e89b-42d3-a456-426614174000',
        authorityGeneration: 1,
        leaseEpoch: 1,
        fencingEpoch: 1,
        heartbeatSeq: 1,
        sourceReportedAt: '2026-08-25T08:00:00.000Z',
        report: {
          runtimeVersion: '1.4.178-rc.7',
          runtimeProtocolVersion: 3,
          capabilities: ['pairing-v3'],
          readiness: 'READY',
          readinessReasonCode: 'healthy',
          startedAt: '2026-08-25T07:59:00.000Z',
          connectionCapabilities: ['orca-direct']
        }
      },
      context
    )
    const input = JSON.stringify({
      authorityId: request.proof.authorityId,
      bodySha256: request.proof.bodySha256,
      issuedAt: request.proof.issuedAt,
      method: request.proof.method,
      nonce: request.proof.nonce,
      path: request.proof.path,
      protocolVersion: request.proof.protocolVersion
    })

    expect(verifies(input, request.proof.signature)).toBe(true)
  })
})
