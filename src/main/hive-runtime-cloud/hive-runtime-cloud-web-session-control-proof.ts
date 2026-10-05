import type { HiveRuntimeCloudIdentity } from './hive-runtime-cloud-identity-store'
import {
  RUNTIME_DISPLAY_METADATA_PATH,
  RUNTIME_DISPLAY_METADATA_PROTOCOL,
  RUNTIME_DISPLAY_METADATA_PROOF_PROTOCOL
} from '../../shared/runtime-display-metadata'
import {
  attachSignature,
  baseProof,
  canonicalRuntimeHeartbeatBody,
  heartbeatSignatureInput,
  sha256,
  type ProofContext
} from './hive-runtime-cloud-proof'

type RuntimeControlTuple = Readonly<{
  authorityGeneration: number
  runtimeRecordId: string
  bootId: string
  heartbeatLeaseId: string
  leaseEpoch: number
  fencingEpoch: number
}>

export type RuntimeWebSessionRevocationAcknowledgement = Readonly<{
  managedWebSessionId: string
  controlVersion: number
  action: 'REVOKE'
}>

function createControlRequest<T extends Record<string, unknown>>(
  identity: HiveRuntimeCloudIdentity,
  body: T,
  protocolVersion: string,
  path: string,
  context: ProofContext
) {
  const unsigned = baseProof(
    protocolVersion,
    path,
    sha256(canonicalRuntimeHeartbeatBody(body)),
    context
  )
  return attachSignature(body, unsigned, heartbeatSignatureInput(unsigned), identity)
}

export function createRuntimeWebSessionControlPullRequest(
  identity: HiveRuntimeCloudIdentity,
  input: RuntimeControlTuple & Readonly<{ limit: number }>,
  context: ProofContext
) {
  const body = {
    protocolVersion: 'web-session-control-pull/v1',
    authorityGeneration: input.authorityGeneration,
    runtimeRecordId: input.runtimeRecordId,
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    heartbeatLeaseId: input.heartbeatLeaseId,
    leaseEpoch: input.leaseEpoch,
    fencingEpoch: input.fencingEpoch,
    limit: input.limit
  }
  return createControlRequest(
    identity,
    body,
    'hive-runtime-web-session-control-pull/v1',
    '/hive/v1/runtime-web-sessions/control-pull',
    context
  )
}

export function createRuntimeWebSessionDisplayMetadataRequest(
  identity: HiveRuntimeCloudIdentity,
  input: RuntimeControlTuple &
    Readonly<{
      managedWebSessionId: string
      runtimeSessionId: string
      expectedOwnershipEpoch: number
    }>,
  context: ProofContext
) {
  return createControlRequest(
    identity,
    {
      protocolVersion: RUNTIME_DISPLAY_METADATA_PROTOCOL,
      managedWebSessionId: input.managedWebSessionId,
      runtimeSessionId: input.runtimeSessionId,
      authorityGeneration: input.authorityGeneration,
      runtimeRecordId: input.runtimeRecordId,
      runtimeInstanceId: identity.runtimeInstanceId,
      bootId: input.bootId,
      heartbeatLeaseId: input.heartbeatLeaseId,
      leaseEpoch: input.leaseEpoch,
      fencingEpoch: input.fencingEpoch,
      expectedOwnershipEpoch: input.expectedOwnershipEpoch
    },
    RUNTIME_DISPLAY_METADATA_PROOF_PROTOCOL,
    RUNTIME_DISPLAY_METADATA_PATH,
    context
  )
}

export function createRuntimeWebSessionRevocationAckRequest(
  identity: HiveRuntimeCloudIdentity,
  input: RuntimeControlTuple &
    Readonly<{ acknowledgements: readonly RuntimeWebSessionRevocationAcknowledgement[] }>,
  context: ProofContext
) {
  const body = {
    protocolVersion: 'web-session-revocation-ack/v1',
    authorityGeneration: input.authorityGeneration,
    runtimeRecordId: input.runtimeRecordId,
    runtimeInstanceId: identity.runtimeInstanceId,
    bootId: input.bootId,
    heartbeatLeaseId: input.heartbeatLeaseId,
    leaseEpoch: input.leaseEpoch,
    fencingEpoch: input.fencingEpoch,
    acknowledgements: input.acknowledgements.map((acknowledgement) => ({ ...acknowledgement }))
  }
  return createControlRequest(
    identity,
    body,
    'hive-runtime-web-session-revocation-ack/v1',
    '/hive/v1/runtime-web-sessions/revocation-acks',
    context
  )
}
