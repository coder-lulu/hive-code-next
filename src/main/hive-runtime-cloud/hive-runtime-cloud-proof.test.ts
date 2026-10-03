import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  canonicalRuntimeHeartbeatBody,
  createRuntimeClaimCapabilityReissueRequest,
  createRuntimeClaimChallengeRequest,
  createRuntimeClaimReconcileRequest,
  createRuntimeConnectionTicketConsumeRequest,
  createRuntimeHeartbeatRequest,
  createRuntimeLeaseAcquireRequest,
  createRuntimeRegistrationRequest
} from './hive-runtime-cloud-proof'
import {
  createRuntimeWebSessionControlPullRequest,
  createRuntimeWebSessionRevocationAckRequest
} from './hive-runtime-cloud-web-session-control-proof'

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

  it('binds claim recovery proofs to each frozen path and protected field order', () => {
    const runtimeRecordId = '623e4567-e89b-42d3-a456-426614174000'
    const inputs = [
      createRuntimeClaimCapabilityReissueRequest(
        identity,
        { runtimeRecordId, expectedVersion: 2 },
        context
      ),
      createRuntimeClaimReconcileRequest(
        identity,
        { runtimeRecordId, expectedVersion: 2 },
        context
      ),
      createRuntimeClaimChallengeRequest(identity, { runtimeRecordId, expectedVersion: 2 }, context)
    ]

    for (const request of inputs) {
      const { proof, ...body } = request
      const signatureInput = [
        proof.protocolVersion,
        proof.algorithm,
        proof.method,
        proof.path,
        proof.authorityId,
        proof.issuedAt,
        proof.nonce,
        proof.bodySha256
      ].join('\n')
      expect(proof.bodySha256).toBe(
        createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex')
      )
      expect(verifies(signatureInput, proof.signature)).toBe(true)
    }
    expect(inputs.map(({ proof }) => [proof.protocolVersion, proof.path])).toEqual([
      [
        'hive-runtime-claim-capability-reissue/v1',
        `/hive/v1/runtime-records/${runtimeRecordId}/reclaim-capabilities`
      ],
      [
        'hive-runtime-claim-reconcile/v1',
        `/hive/v1/runtime-records/${runtimeRecordId}/claim-reconcile`
      ],
      ['hive-runtime-claim-challenge/v1', '/hive/v1/runtime-claim-challenges']
    ])
  })

  it('includes the intended account in the signed challenge body', () => {
    const request = createRuntimeClaimChallengeRequest(
      identity,
      {
        runtimeRecordId: '623e4567-e89b-42d3-a456-426614174000',
        expectedVersion: 2,
        expectedAccountId: '223e4567-e89b-42d3-a456-426614174000'
      },
      context
    )
    const { proof, ...body } = request
    expect(proof.bodySha256).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex'))
    expect(Object.keys(body)).toEqual([
      'runtimeRecordId',
      'runtimeInstanceId',
      'identityPublicKey',
      'expectedVersion',
      'expectedAccountId'
    ])
    expect(proof.bodySha256).not.toBe(
      createHash('sha256')
        .update(
          JSON.stringify({ ...body, expectedAccountId: '323e4567-e89b-42d3-a456-426614174000' })
        )
        .digest('hex')
    )
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
          connectionCapabilities: ['orca-direct'],
          deviceName: 'build-host',
          osName: 'Linux',
          osVersion: '#1 SMP',
          osArch: 'arm64',
          cpuModel: 'Example CPU',
          cpuLogicalCores: 8,
          totalMemoryBytes: 32 * 1024 ** 3,
          freeDiskBytes: 512 * 1024 ** 3
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

    expect(request.report).toMatchObject({
      deviceName: 'build-host',
      osName: 'Linux',
      osVersion: '#1 SMP',
      osArch: 'arm64',
      cpuModel: 'Example CPU',
      cpuLogicalCores: 8,
      totalMemoryBytes: 32 * 1024 ** 3,
      freeDiskBytes: 512 * 1024 ** 3
    })
    expect(verifies(input, request.proof.signature)).toBe(true)
  })

  it('signs a Connection Ticket consume over the recursively sorted protected body', () => {
    const request = createRuntimeConnectionTicketConsumeRequest(
      identity,
      {
        ticketId: '523e4567-e89b-42d3-a456-426614174000',
        launchSecret: 'A'.repeat(43),
        authorityGeneration: 2,
        runtimeRecordId: '623e4567-e89b-42d3-a456-426614174000',
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        heartbeatLeaseId: '423e4567-e89b-42d3-a456-426614174000',
        leaseEpoch: 3,
        fencingEpoch: 4
      },
      context
    )
    const { proof, ...protectedBody } = request
    const input = JSON.stringify({
      authorityId: proof.authorityId,
      bodySha256: proof.bodySha256,
      issuedAt: proof.issuedAt,
      method: proof.method,
      nonce: proof.nonce,
      path: proof.path,
      protocolVersion: proof.protocolVersion
    })

    expect(protectedBody).toMatchObject({
      protocolVersion: 'web-launch-consume/v1',
      runtimeInstanceId: identity.runtimeInstanceId
    })
    expect(proof).toMatchObject({
      protocolVersion: 'hive-runtime-connection-ticket-consume/v1',
      path: '/hive/v1/connection-tickets'
    })
    expect(proof.bodySha256).toBe(
      createHash('sha256')
        .update(canonicalRuntimeHeartbeatBody(protectedBody), 'utf8')
        .digest('hex')
    )
    expect(verifies(input, proof.signature)).toBe(true)
  })

  it('publishes a web endpoint only when every endpoint field is available', () => {
    const baseReport = {
      runtimeVersion: '1.4.178-rc.7',
      runtimeProtocolVersion: 3 as const,
      capabilities: ['web-launch-grant-v1'] as const,
      readiness: 'READY' as const,
      readinessReasonCode: 'healthy' as const,
      startedAt: '2026-08-25T07:59:00.000Z',
      connectionCapabilities: ['orca-direct'] as const
    }
    const full = createRuntimeHeartbeatRequest(
      identity,
      {
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        leaseId: '423e4567-e89b-42d3-a456-426614174000',
        authorityGeneration: 1,
        leaseEpoch: 1,
        fencingEpoch: 1,
        heartbeatSeq: 2,
        sourceReportedAt: '2026-08-25T08:00:00.000Z',
        report: {
          ...baseReport,
          webHttpsOrigin: 'https://code.hivekernel.com',
          webClientPath: '/web',
          websocketPath: '/runtime',
          webEndpointExpiresAt: '2026-08-25T08:01:15.000Z'
        }
      },
      context
    )
    const partial = createRuntimeHeartbeatRequest(
      identity,
      {
        bootId: '323e4567-e89b-42d3-a456-426614174000',
        leaseId: '423e4567-e89b-42d3-a456-426614174000',
        authorityGeneration: 1,
        leaseEpoch: 1,
        fencingEpoch: 1,
        heartbeatSeq: 3,
        sourceReportedAt: '2026-08-25T08:00:00.000Z',
        report: { ...baseReport, webHttpsOrigin: 'https://code.hivekernel.com' }
      },
      context
    )

    expect(full.report).toMatchObject({
      webHttpsOrigin: 'https://code.hivekernel.com',
      webClientPath: '/web',
      websocketPath: '/runtime',
      webEndpointExpiresAt: '2026-08-25T08:01:15.000Z'
    })
    expect(partial.report).not.toHaveProperty('webHttpsOrigin')
    expect(partial.report).not.toHaveProperty('deviceName')
  })

  it('binds control pull and revocation ack proofs to the current full tuple', () => {
    const tuple = {
      authorityGeneration: 2,
      runtimeRecordId: '623e4567-e89b-42d3-a456-426614174000',
      bootId: '323e4567-e89b-42d3-a456-426614174000',
      heartbeatLeaseId: '423e4567-e89b-42d3-a456-426614174000',
      leaseEpoch: 3,
      fencingEpoch: 4
    }
    const pull = createRuntimeWebSessionControlPullRequest(
      identity,
      { ...tuple, limit: 50 },
      context
    )
    const acknowledgement = {
      managedWebSessionId: '523e4567-e89b-42d3-a456-426614174000',
      controlVersion: 2,
      action: 'REVOKE' as const
    }
    const ack = createRuntimeWebSessionRevocationAckRequest(
      identity,
      { ...tuple, acknowledgements: [acknowledgement] },
      context
    )

    expect(pull).toMatchObject({
      protocolVersion: 'web-session-control-pull/v1',
      ...tuple,
      runtimeInstanceId: identity.runtimeInstanceId,
      limit: 50,
      proof: {
        protocolVersion: 'hive-runtime-web-session-control-pull/v1',
        path: '/hive/v1/runtime-web-sessions/control-pull'
      }
    })
    expect(ack).toMatchObject({
      protocolVersion: 'web-session-revocation-ack/v1',
      ...tuple,
      runtimeInstanceId: identity.runtimeInstanceId,
      acknowledgements: [acknowledgement],
      proof: {
        protocolVersion: 'hive-runtime-web-session-revocation-ack/v1',
        path: '/hive/v1/runtime-web-sessions/revocation-acks'
      }
    })
    for (const request of [pull, ack]) {
      const { proof, ...protectedBody } = request
      const input = JSON.stringify({
        authorityId: proof.authorityId,
        bodySha256: proof.bodySha256,
        issuedAt: proof.issuedAt,
        method: proof.method,
        nonce: proof.nonce,
        path: proof.path,
        protocolVersion: proof.protocolVersion
      })
      expect(proof.bodySha256).toBe(
        createHash('sha256')
          .update(canonicalRuntimeHeartbeatBody(protectedBody), 'utf8')
          .digest('hex')
      )
      expect(verifies(input, proof.signature)).toBe(true)
    }
  })
})
