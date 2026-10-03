import { z } from 'zod'
import {
  SessionAdjudicationSchema,
  SessionTransitionSchema
} from './hiverelay-contract-session-rules'
import {
  hasExactKeys,
  object,
  type HiveRelayContractVerdict
} from './hiverelay-contract-state-rules'

const SafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const PositiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const Instant = z.string().refine((value) => Number.isFinite(Date.parse(value)))

const ProofSchema = z
  .object({
    protocolVersion: z.literal('hive-runtime-heartbeat/v1'),
    algorithm: z.literal('Ed25519'),
    method: z.literal('POST'),
    path: z.literal('/hive/v1/runtime-heartbeats'),
    authorityId: OpaqueId,
    issuedAt: Instant,
    nonce: UuidV4,
    bodySha256: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
  })
  .strict()

const LegacyReportSchema = z
  .object({
    runtimeVersion: z
      .string()
      .max(64)
      .regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/),
    runtimeProtocolVersion: z.union([z.literal(2), z.literal(3)]),
    capabilities: z
      .array(
        z.enum([
          'connection-ticket-v1',
          'pairing-v3',
          'runtime-health-v1',
          'shared-control-v1',
          'web-session-display-metadata-v1',
          'web-launch-grant-v1'
        ])
      )
      .max(5),
    readiness: z.enum(['STARTING', 'READY', 'DEGRADED', 'RECOVERING', 'STOPPED']),
    readinessReasonCode: z
      .enum([
        'starting',
        'healthy',
        'disk_pressure',
        'identity_unavailable',
        'network_unavailable',
        'upgrade_required',
        'recovery_in_progress'
      ])
      .optional(),
    startedAt: Instant,
    freeDiskBytes: SafeInteger.optional(),
    lastBackupAt: Instant.nullable().optional(),
    connectionCapabilities: z
      .array(
        z.enum([
          'orca-direct',
          'orca-relay',
          'hive-direct',
          'hive-relay',
          'tailscale-embedded-evaluation'
        ])
      )
      .max(5),
    webHttpsOrigin: z.string().max(256).optional(),
    webClientPath: z.string().max(256).optional(),
    websocketPath: z.string().max(256).optional(),
    webEndpointExpiresAt: Instant.optional(),
    deviceName: z.string().max(255).optional(),
    osName: z.string().max(64).optional(),
    osVersion: z.string().max(128).optional(),
    osArch: z.string().max(32).optional(),
    cpuModel: z.string().max(255).optional(),
    cpuLogicalCores: z.number().int().min(1).max(65_536).optional(),
    totalMemoryBytes: PositiveInteger.optional()
  })
  .strict()

const LegacyRequestSchema = z
  .object({
    runtimeInstanceId: UuidV4,
    bootId: UuidV4,
    cloudSessionId: UuidV4,
    leaseId: UuidV4,
    authorityGeneration: PositiveInteger,
    leaseEpoch: PositiveInteger,
    fencingEpoch: PositiveInteger,
    heartbeatSeq: SafeInteger,
    sourceReportedAt: Instant,
    report: LegacyReportSchema,
    clientAuthMode: z.enum(['MTLS', 'IDENTITY_PROOF']).optional(),
    proof: ProofSchema
  })
  .strict()

const LegacyResponseSchema = z
  .object({
    leaseId: UuidV4,
    authorityGeneration: PositiveInteger,
    leaseEpoch: PositiveInteger,
    fencingEpoch: PositiveInteger,
    acceptedHeartbeatSeq: SafeInteger,
    observedAt: Instant,
    leaseExpiresAt: Instant,
    presence: z.enum(['ONLINE', 'STALE', 'OFFLINE', 'FENCED']),
    duplicate: z.boolean()
  })
  .strict()

const ControlAckSchema = z
  .object({
    sequence: PositiveInteger,
    commandId: UuidV4,
    acknowledgedResourceVersion: PositiveInteger
  })
  .strict()

const RelayControlSchema = z
  .object({
    assignmentId: UuidV4,
    cellId: OpaqueId,
    cellIncarnationId: UuidV4,
    assignmentEpoch: SafeInteger,
    controlGeneration: SafeInteger,
    controlConnectionAcknowledged: z.boolean(),
    controlCommandAck: ControlAckSchema.nullable(),
    sessionTransitions: z.array(SessionTransitionSchema).max(128)
  })
  .strict()

const StoredControlCommandSchema = z
  .object({
    sequence: PositiveInteger,
    commandId: UuidV4,
    targetResourceVersion: PositiveInteger
  })
  .strict()

const ControlCommandSchema = z
  .object({
    sequence: PositiveInteger,
    commandId: UuidV4,
    commandType: z.literal('SESSION_REVOKE'),
    managedSessionId: UuidV4,
    assignmentId: UuidV4,
    targetResourceVersion: PositiveInteger,
    targetControlVersion: PositiveInteger,
    reason: z.enum([
      'ACCOUNT_SESSION_REVOKED',
      'ACCOUNT_DEVICE_REVOKED',
      'ACCOUNT_DELETION',
      'RUNTIME_AUTHORITY_REVOKED',
      'RUNTIME_CREDENTIAL_REVOKED',
      'ADMINISTRATIVE'
    ])
  })
  .strict()

const ControlResponseSchema = z
  .object({
    responseVersion: z.literal('runtime-session-control/v1'),
    ackedSessionTransitionSequence: SafeInteger,
    sessionTransitionResults: z.array(SessionAdjudicationSchema).max(128),
    sessionAuthorityUntil: Instant.nullable(),
    ackedControlSequence: SafeInteger,
    controlCommands: z.array(ControlCommandSchema).max(128),
    nextControlSequence: SafeInteger
  })
  .strict()

export function evaluateHeartbeatControl(
  input: Record<string, unknown>,
  validationTime: number
): HiveRelayContractVerdict {
  if (input.legacyRequest !== undefined || input.legacyResponse !== undefined) {
    if (!hasExactKeys(input, ['legacyRequest', 'legacyResponse'])) {
      return ['REJECT', 'INVALID_LEGACY_HEARTBEAT_SHAPE']
    }
    const request = LegacyRequestSchema.safeParse(input.legacyRequest)
    const response = LegacyResponseSchema.safeParse(input.legacyResponse)
    if (!request.success || !response.success) {
      return ['REJECT', 'INVALID_LEGACY_HEARTBEAT_SHAPE']
    }
    const valid =
      request.data.leaseId === response.data.leaseId &&
      request.data.authorityGeneration === response.data.authorityGeneration &&
      request.data.leaseEpoch === response.data.leaseEpoch &&
      request.data.fencingEpoch === response.data.fencingEpoch &&
      request.data.heartbeatSeq === response.data.acceptedHeartbeatSeq
    return valid
      ? ['ACCEPT', 'VALID_LEGACY_HEARTBEAT_SHAPE']
      : ['REJECT', 'INVALID_LEGACY_HEARTBEAT_SHAPE']
  }

  const expectedKeys = [
    'relayControl',
    ...(input.storedControlCommand === undefined ? [] : ['storedControlCommand']),
    'response'
  ]
  if (!hasExactKeys(input, expectedKeys)) {
    return ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
  }
  const relay = RelayControlSchema.safeParse(input.relayControl)
  if (!relay.success) {
    const relayObject = object(input.relayControl)
    return relayObject && typeof relayObject.controlCommandAck === 'number'
      ? ['REJECT', 'INVALID_CONTROL_ACK']
      : ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
  }
  const response = ControlResponseSchema.safeParse(input.response)
  if (!response.success) {
    return ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
  }
  const stored =
    input.storedControlCommand === undefined
      ? null
      : StoredControlCommandSchema.safeParse(input.storedControlCommand)
  if (stored && !stored.success) {
    return ['REJECT', 'INVALID_CONTROL_ACK']
  }
  const ack = relay.data.controlCommandAck
  if (
    ack &&
    stored?.success &&
    (ack.sequence !== stored.data.sequence ||
      ack.commandId !== stored.data.commandId ||
      ack.acknowledgedResourceVersion !== stored.data.targetResourceVersion)
  ) {
    return ['REJECT', 'INVALID_CONTROL_ACK']
  }
  if (ack && ack.sequence > response.data.ackedControlSequence) {
    return ['REJECT', 'INVALID_CONTROL_ACK']
  }
  if (
    response.data.nextControlSequence !==
    response.data.ackedControlSequence + response.data.controlCommands.length + 1
  ) {
    return ['REJECT', 'INVALID_CONTROL_ACK']
  }
  if (
    response.data.controlCommands.some(
      (command, index) =>
        command.sequence !== response.data.ackedControlSequence + index + 1 ||
        command.assignmentId !== relay.data.assignmentId
    )
  ) {
    return ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
  }
  if (
    relay.data.sessionTransitions.length !== response.data.sessionTransitionResults.length ||
    relay.data.sessionTransitions.some((transition, index) => {
      const adjudication = response.data.sessionTransitionResults[index]
      return (
        transition.sequence !== adjudication.sequence ||
        transition.transitionId !== adjudication.transitionId
      )
    })
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  const authorityUntil = response.data.sessionAuthorityUntil
  if (authorityUntil === null) {
    if (relay.data.controlConnectionAcknowledged) {
      return ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
    }
  } else {
    const deadline = Date.parse(authorityUntil)
    if (
      !relay.data.controlConnectionAcknowledged ||
      deadline <= validationTime ||
      deadline > validationTime + 120_000
    ) {
      return ['REJECT', 'INVALID_HEARTBEAT_CONTROL']
    }
  }
  return ['ACCEPT', 'VALID_HEARTBEAT_CONTROL']
}
