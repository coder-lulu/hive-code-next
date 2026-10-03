import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto'
import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import type { HiveRuntimeRelayHeartbeatControl } from './relay-host/hive-runtime-relay-heartbeat-types'

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
  | 'runtime-session-control-v1'

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
  | 'ticket-connect-v2'

export type HiveRuntimeCloudReport = Readonly<{
  runtimeVersion: string
  runtimeProtocolVersion: 3
  capabilities: readonly HiveRuntimeCloudCapability[]
  readiness: 'STARTING' | 'READY' | 'DEGRADED' | 'RECOVERING' | 'STOPPED'
  readinessReasonCode: HiveRuntimeCloudReadinessReason
  startedAt: string
  connectionCapabilities: readonly HiveRuntimeCloudConnectionCapability[]
  deviceName?: string
  osName?: string
  osVersion?: string
  osArch?: string
  cpuModel?: string
  cpuLogicalCores?: number
  totalMemoryBytes?: number
  freeDiskBytes?: number
  webHttpsOrigin?: string
  webClientPath?: string
  websocketPath?: string
  webEndpointExpiresAt?: string
  relayControl?: HiveRuntimeRelayHeartbeatControl
}>

export type ProofContext = Readonly<{ authorityId: string; issuedAt?: string; nonce?: string }>

function privateKey(identity: HiveRuntimeCloudIdentity) {
  return createPrivateKey({
    key: Buffer.from(identity.privateKeyPkcs8, 'base64'),
    format: 'der',
    type: 'pkcs8'
  })
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function baseProof(
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

export function lfSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
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

export function fixedJsonSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
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

export function heartbeatSignatureInput(proof: Omit<HiveRuntimeCloudProof, 'signature'>): string {
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

export function attachSignature<T extends Record<string, unknown>>(
  body: T,
  unsigned: Omit<HiveRuntimeCloudProof, 'signature'>,
  signatureInput: string,
  identity: HiveRuntimeCloudIdentity
): T & { proof: HiveRuntimeCloudProof } {
  return {
    ...body,
    proof: {
      ...unsigned,
      signature: signRuntimeIdentityPayload(signatureInput, identity)
    }
  }
}

export function signRuntimeIdentityPayload(
  input: string,
  identity: HiveRuntimeCloudIdentity
): string {
  return sign(null, Buffer.from(input, 'utf8'), privateKey(identity)).toString('base64url')
}
