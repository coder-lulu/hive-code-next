import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  attachSignature,
  baseProof,
  canonicalRuntimeHeartbeatBody,
  fixedJsonSignatureInput,
  heartbeatSignatureInput,
  lfSignatureInput,
  sha256,
  type HiveRuntimeCloudCapability,
  type HiveRuntimeCloudReport,
  type ProofContext
} from './hive-runtime-cloud-proof-core'

export {
  attachSignature,
  baseProof,
  canonicalRuntimeHeartbeatBody,
  heartbeatSignatureInput,
  sha256
} from './hive-runtime-cloud-proof-core'
export type {
  HiveRuntimeCloudCapability,
  HiveRuntimeCloudConnectionCapability,
  HiveRuntimeCloudProof,
  HiveRuntimeCloudReadinessReason,
  HiveRuntimeCloudReport,
  ProofContext
} from './hive-runtime-cloud-proof-core'

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

function createRuntimeRecordProofRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{ runtimeRecordId: string; expectedVersion: number }>,
  context: ProofContext,
  operation: 'claim-capability-reissue' | 'claim-reconcile'
) {
  const path = `/hive/v1/runtime-records/${input.runtimeRecordId}/${
    operation === 'claim-capability-reissue' ? 'reclaim-capabilities' : 'claim-reconcile'
  }`
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    identityPublicKey: identity.publicKey,
    expectedVersion: input.expectedVersion
  }
  const unsigned = baseProof(
    `hive-runtime-${operation}/v1`,
    path,
    sha256(JSON.stringify(body)),
    context
  )
  return attachSignature(body, unsigned, lfSignatureInput(unsigned), identity)
}

export function createRuntimeClaimCapabilityReissueRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{ runtimeRecordId: string; expectedVersion: number }>,
  context: ProofContext
) {
  return createRuntimeRecordProofRequest(identity, input, context, 'claim-capability-reissue')
}

export function createRuntimeClaimReconcileRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{ runtimeRecordId: string; expectedVersion: number }>,
  context: ProofContext
) {
  return createRuntimeRecordProofRequest(identity, input, context, 'claim-reconcile')
}

export function createRuntimeClaimChallengeRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{ runtimeRecordId: string; expectedVersion: number; expectedAccountId?: string }>,
  context: ProofContext
) {
  const body = {
    runtimeRecordId: input.runtimeRecordId,
    runtimeInstanceId: identity.runtimeInstanceId,
    identityPublicKey: identity.publicKey,
    expectedVersion: input.expectedVersion,
    ...(input.expectedAccountId ? { expectedAccountId: input.expectedAccountId } : {})
  }
  const unsigned = baseProof(
    'hive-runtime-claim-challenge/v1',
    '/hive/v1/runtime-claim-challenges',
    sha256(JSON.stringify(body)),
    context
  )
  return attachSignature(body, unsigned, lfSignatureInput(unsigned), identity)
}

export function createRuntimeLeaseAcquireRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{
    bootId: string
    cloudSessionId: string
    expectedAuthorityGeneration: number
    expectedLeaseEpoch: number
    expectedFencingEpoch: number
  }>,
  context: ProofContext
) {
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    cloudSessionId: input.cloudSessionId,
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
    cloudSessionId: string
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
  const hasCompleteWebEndpoint =
    input.report.webHttpsOrigin !== undefined &&
    input.report.webClientPath !== undefined &&
    input.report.websocketPath !== undefined &&
    input.report.webEndpointExpiresAt !== undefined
  const body = {
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    cloudSessionId: input.cloudSessionId,
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
      connectionCapabilities: [...input.report.connectionCapabilities],
      ...(input.report.relayControl
        ? { relayControl: structuredClone(input.report.relayControl) }
        : {}),
      ...(input.report.deviceName !== undefined ? { deviceName: input.report.deviceName } : {}),
      ...(input.report.osName !== undefined ? { osName: input.report.osName } : {}),
      ...(input.report.osVersion !== undefined ? { osVersion: input.report.osVersion } : {}),
      ...(input.report.osArch !== undefined ? { osArch: input.report.osArch } : {}),
      ...(input.report.cpuModel !== undefined ? { cpuModel: input.report.cpuModel } : {}),
      ...(input.report.cpuLogicalCores !== undefined
        ? { cpuLogicalCores: input.report.cpuLogicalCores }
        : {}),
      ...(input.report.totalMemoryBytes !== undefined
        ? { totalMemoryBytes: input.report.totalMemoryBytes }
        : {}),
      ...(input.report.freeDiskBytes !== undefined
        ? { freeDiskBytes: input.report.freeDiskBytes }
        : {}),
      ...(hasCompleteWebEndpoint
        ? {
            webHttpsOrigin: input.report.webHttpsOrigin,
            webClientPath: input.report.webClientPath,
            websocketPath: input.report.websocketPath,
            webEndpointExpiresAt: input.report.webEndpointExpiresAt
          }
        : {})
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

export function createRuntimeConnectionTicketConsumeRequest(
  identity: HiveRuntimeCloudIdentity,
  input: Readonly<{
    ticketId: string
    launchSecret: string
    authorityGeneration: number
    runtimeRecordId: string
    bootId: string
    heartbeatLeaseId: string
    leaseEpoch: number
    fencingEpoch: number
  }>,
  context: ProofContext
) {
  const body = {
    protocolVersion: 'web-launch-consume/v1',
    ticketId: input.ticketId,
    launchSecret: input.launchSecret,
    authorityGeneration: input.authorityGeneration,
    runtimeRecordId: input.runtimeRecordId,
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    heartbeatLeaseId: input.heartbeatLeaseId,
    leaseEpoch: input.leaseEpoch,
    fencingEpoch: input.fencingEpoch
  }
  const unsigned = baseProof(
    'hive-runtime-connection-ticket-consume/v1',
    '/hive/v1/connection-tickets',
    sha256(canonicalRuntimeHeartbeatBody(body)),
    context
  )
  return attachSignature(body, unsigned, heartbeatSignatureInput(unsigned), identity)
}
