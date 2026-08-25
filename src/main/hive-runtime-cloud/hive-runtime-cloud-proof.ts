import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'

const ALGORITHM = 'Ed25519' as const
const METHOD = 'POST' as const

export type HiveRuntimeCloudProof = Readonly<{
  protocolVersion: string
  algorithm: typeof ALGORITHM
  method: typeof METHOD
  path: string
  authorityId: string
  issuedAt: string
  nonce: string
  bodySha256: string
  signature: string
}>

export type HiveRuntimeCloudCapability =
  | 'connection-ticket-v1'
  | 'pairing-v3'
  | 'runtime-health-v1'
  | 'shared-control-v1'
  | 'web-launch-grant-v1'

export type HiveRuntimeCloudReadinessReason =
  | 'starting'
  | 'healthy'
  | 'disk_pressure'
  | 'identity_unavailable'
  | 'network_unavailable'
  | 'upgrade_required'
  | 'recovery_in_progress'

export type HiveRuntimeCloudConnectionCapability =
  | 'orca-direct'
  | 'orca-relay'
  | 'hive-direct'
  | 'hive-relay'
  | 'tailscale-embedded-evaluation'

export type HiveRuntimeCloudReport = Readonly<{
  runtimeVersion: string
  runtimeProtocolVersion: 3
  capabilities: readonly HiveRuntimeCloudCapability[]
  readiness: 'STARTING' | 'READY' | 'DEGRADED' | 'RECOVERING' | 'STOPPED'
  readinessReasonCode: HiveRuntimeCloudReadinessReason
  startedAt: string
  connectionCapabilities: readonly HiveRuntimeCloudConnectionCapability[]
}>

type ProofContext = Readonly<{
  authorityId: string
  issuedAt?: string
  nonce?: string
}>

function privateKey(identity: HiveRuntimeCloudIdentity) {
  return createPrivateKey({
    key: Buffer.from(identity.privateKeyPkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function baseProof(
  protocolVersion: string,
  path: string,
  bodySha256: string,
  context: ProofContext
): Omit<HiveRuntimeCloudProof, 'signature'> {
  return {
    protocolVersion,
    algorithm: ALGORITHM,
    method: METHOD,
    path,
    authorityId: context.authorityId,
    issuedAt: context.issuedAt ?? new Date().toISOString(),
    nonce: context.nonce ?? randomUUID(),
    bodySha256
  }
}

function lfSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
  return [
    proof.protocolVersion,
    proof.algorithm,
    proof.method,
    proof.path,
    proof.authorityId,
    proof.issuedAt,
    proof.nonce,
    proof.bodySha256
  ].join('\n')
}

function fixedJsonSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
  return JSON.stringify({
    protocolVersion: proof.protocolVersion,
    method: proof.method,
    path: proof.path,
    authorityId: proof.authorityId,
    bodySha256: proof.bodySha256,
    nonce: proof.nonce,
    issuedAt: proof.issuedAt
  })
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalValue(item)])
    )
  }
  return value
}

export function canonicalRuntimeHeartbeatBody(value: Record<string, unknown>): string {
  return JSON.stringify(canonicalValue(value))
}

function heartbeatSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
  return JSON.stringify({
    authorityId: proof.authorityId,
    bodySha256: proof.bodySha256,
    issuedAt: proof.issuedAt,
    method: proof.method,
    nonce: proof.nonce,
    path: proof.path,
    protocolVersion: proof.protocolVersion
  })
}

function attachSignature<T extends Record<string, unknown>>(
  body: T,
  unsigned: Omit<HiveRuntimeCloudProof, 'signature'>,
  signatureInput: string,
  identity: HiveRuntimeCloudIdentity
): T & { proof: HiveRuntimeCloudProof } {
  return {
    ...body,
    proof: {
      ...unsigned,
      signature: sign(null, Buffer.from(signatureInput, 'utf8'), privateKey(identity)).toString(
        'base64url'
      )
    }
  }
}

export function createRuntimeRegistrationRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{
    bootId: string
    runtimeVersion: string
    capabilities: readonly HiveRuntimeCloudCapability[]
  }>,
  context: ProofContext
) {
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    identityPublicKey: identity.publicKey,
    bootId: input.bootId,
    runtimeVersion: input.runtimeVersion,
    runtimeProtocolVersion: 3,
    capabilities: [...input.capabilities]
  }
  const unsigned = baseProof(
    'hive-runtime-registration/v1',
    '/hive/v1/runtime-registrations',
    sha256(JSON.stringify(body)),
    context
  )
  return attachSignature(body, unsigned, lfSignatureInput(unsigned), identity)
}

export function createRuntimeRegistrationLookupRequest(
  identity: HiveRuntimeCloudIdentity,
  context: ProofContext
) {
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    identityPublicKey: identity.publicKey
  }
  const unsigned = baseProof(
    'hive-runtime-registration-lookup/v1',
    '/hive/v1/runtime-registrations/lookup',
    sha256(JSON.stringify(body)),
    context
  )
  return attachSignature(body, unsigned, lfSignatureInput(unsigned), identity)
}

export function createRuntimeLeaseAcquireRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{
    bootId: string
    expectedAuthorityGeneration: number
    expectedLeaseEpoch: number
    expectedFencingEpoch: number
  }>,
  context: ProofContext
) {
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    expectedAuthorityGeneration: input.expectedAuthorityGeneration,
    expectedLeaseEpoch: input.expectedLeaseEpoch,
    expectedFencingEpoch: input.expectedFencingEpoch,
    clientAuthMode: 'IDENTITY_PROOF'
  }
  const unsigned = baseProof(
    'hive-runtime-lease-acquire/v1',
    '/hive/v1/runtime-leases/acquire',
    sha256(JSON.stringify(body)),
    context
  )
  return attachSignature(body, unsigned, fixedJsonSignatureInput(unsigned), identity)
}

export function createRuntimeHeartbeatRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{
    bootId: string
    leaseId: string
    authorityGeneration: number
    leaseEpoch: number
    fencingEpoch: number
    heartbeatSeq: number
    sourceReportedAt: string
    report: HiveRuntimeCloudReport
  }>,
  context: ProofContext
) {
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    leaseId: input.leaseId,
    authorityGeneration: input.authorityGeneration,
    leaseEpoch: input.leaseEpoch,
    fencingEpoch: input.fencingEpoch,
    heartbeatSeq: input.heartbeatSeq,
    sourceReportedAt: input.sourceReportedAt,
    report: {
      runtimeVersion: input.report.runtimeVersion,
      runtimeProtocolVersion: input.report.runtimeProtocolVersion,
      capabilities: [...input.report.capabilities],
      readiness: input.report.readiness,
      readinessReasonCode: input.report.readinessReasonCode,
      startedAt: input.report.startedAt,
      connectionCapabilities: [...input.report.connectionCapabilities]
    },
    clientAuthMode: 'IDENTITY_PROOF'
  }
  const unsigned = baseProof(
    'hive-runtime-heartbeat/v1',
    '/hive/v1/runtime-heartbeats',
    sha256(canonicalRuntimeHeartbeatBody(body)),
    context
  )
  return attachSignature(body, unsigned, heartbeatSignatureInput(unsigned), identity)
}
