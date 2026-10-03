import { z } from 'zod'
import { isCanonicalHiveRelayOrigin } from './hiverelay-contract-origin'
import {
  hasExactKeys,
  sameJsonValue,
  type HiveRelayContractVerdict
} from './hiverelay-contract-state-rules'

const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const SafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
const PrefixedSha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/)

function canonicalBase64Url(bytes: number) {
  return z.string().refine((value) => {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
      return false
    }
    const decoded = Buffer.from(value, 'base64url')
    return decoded.byteLength === bytes && decoded.toString('base64url') === value
  })
}

const Base64Url16 = canonicalBase64Url(16)
const Base64Url32 = canonicalBase64Url(32)
const PrivateCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('cell-assignment-fence'),
      v: z.literal(2),
      commandType: z.literal('ASSIGNMENT_FENCE'),
      commandId: UuidV4,
      cellId: OpaqueId,
      targetIncarnationId: UuidV4,
      assignmentId: UuidV4,
      rejectAssignmentEpochAtMost: SafeInteger,
      rejectControlGenerationAtMost: SafeInteger,
      issuedAt: SafeInteger
    })
    .strict(),
  z
    .object({
      type: z.literal('cell-lifecycle-command'),
      v: z.literal(2),
      commandType: z.enum(['INCARNATION_ACTIVATE', 'INCARNATION_DRAIN']),
      commandId: UuidV4,
      cellId: OpaqueId,
      targetIncarnationId: UuidV4,
      lifecycleGeneration: SafeInteger,
      issuedAt: SafeInteger,
      deadlineAt: SafeInteger
    })
    .strict(),
  z
    .object({
      type: z.literal('cell-incarnation-fence'),
      v: z.literal(2),
      commandType: z.literal('INCARNATION_FENCE'),
      commandId: UuidV4,
      cellId: OpaqueId,
      targetIncarnationId: UuidV4,
      lifecycleGeneration: SafeInteger,
      issuedAt: SafeInteger
    })
    .strict()
])
const PrivateCommandResultSchema = z
  .object({
    type: z.literal('cell-command-result'),
    v: z.literal(2),
    commandId: UuidV4,
    commandType: z.enum([
      'ASSIGNMENT_FENCE',
      'INCARNATION_ACTIVATE',
      'INCARNATION_DRAIN',
      'INCARNATION_FENCE'
    ]),
    cellId: OpaqueId,
    targetIncarnationId: UuidV4,
    result: z.enum(['APPLIED', 'STALE_NOOP', 'COMMAND_REPLAY_CONFLICT', 'TARGET_MISMATCH']),
    observedAt: SafeInteger
  })
  .strict()
const ReplayRecordSchema = z
  .object({ commandId: UuidV4, bodySha256: Sha256Hex })
  .strict()
const StoredReplayRecordSchema = ReplayRecordSchema.extend({
  storedResponse: PrivateCommandResultSchema
}).strict()

const unique = <T>(values: T[]): boolean => new Set(values).size === values.length
const StatusAuthSchema = z
  .object({
    carrier: z.string().min(1),
    method: z.string().min(1),
    path: z.string().min(1),
    privateOrigin: z.string().min(1),
    tokenCellId: OpaqueId,
    tokenNonce: Base64Url16,
    headerNonce: Base64Url16,
    tokenJti: UuidV4,
    usedTokenJtis: z.array(UuidV4).refine(unique),
    usedNonces: z.array(Base64Url16).refine(unique)
  })
  .strict()
const StatusResponseSchema = z
  .object({
    type: z.literal('cell-status'),
    v: z.literal(2),
    nonce: Base64Url16,
    cellId: OpaqueId,
    cellIncarnationId: UuidV4,
    publicReady: z.boolean(),
    lifecyclePermit: z.boolean(),
    cryptographicReady: z.boolean(),
    resourceReady: z.boolean(),
    processReady: z.boolean(),
    draining: z.boolean(),
    preAuthSlotsUsed: z.number().int().min(0).max(4_096),
    authenticatedSlotsUsed: z.number().int().min(0).max(10_000),
    acceptedVerifierKids: z.array(OpaqueId).min(1).refine(unique),
    keysetDigest: Base64Url32,
    buildDigest: PrefixedSha256,
    imageDigest: PrefixedSha256,
    observedAt: SafeInteger
  })
  .strict()

function validCommandTime(
  command: z.infer<typeof PrivateCommandSchema>,
  validationTime: number
): HiveRelayContractVerdict | null {
  if (command.issuedAt < validationTime - 30_000) {
    return ['REJECT', 'COMMAND_STALE']
  }
  if (command.issuedAt > validationTime + 30_000) {
    return ['REJECT', 'COMMAND_NOT_YET_VALID']
  }
  if (
    command.type === 'cell-lifecycle-command' &&
    (command.deadlineAt !== command.issuedAt + 120_000 || command.deadlineAt <= validationTime)
  ) {
    return ['REJECT', 'INVALID_DEADLINE']
  }
  return null
}

export function evaluatePrivateCommand(
  input: Record<string, unknown>,
  validationTime: number
): HiveRelayContractVerdict {
  if (input.previous !== undefined || input.current !== undefined) {
    const current = ReplayRecordSchema.safeParse(input.current)
    const basicPrevious = ReplayRecordSchema.safeParse(input.previous)
    if (
      hasExactKeys(input, ['previous', 'current']) &&
      basicPrevious.success &&
      current.success &&
      basicPrevious.data.commandId === current.data.commandId &&
      basicPrevious.data.bodySha256 !== current.data.bodySha256
    ) {
      return ['REJECT', 'COMMAND_REPLAY_CONFLICT']
    }
    const previous = StoredReplayRecordSchema.safeParse(input.previous)
    const expected = PrivateCommandResultSchema.safeParse(input.expectedResponse)
    if (
      !hasExactKeys(input, ['previous', 'current', 'expectedResponse']) ||
      !previous.success ||
      !current.success ||
      !expected.success ||
      previous.data.commandId !== current.data.commandId ||
      previous.data.bodySha256 !== current.data.bodySha256 ||
      previous.data.commandId !== previous.data.storedResponse.commandId ||
      !sameJsonValue(previous.data.storedResponse, expected.data)
    ) {
      return ['REJECT', 'INVALID_PRIVATE_COMMAND']
    }
    return ['ACCEPT', 'IDEMPOTENT_REPLAY']
  }

  if (input.currentLifecycleGeneration !== undefined) {
    const command = PrivateCommandSchema.safeParse(input.command)
    const response = PrivateCommandResultSchema.safeParse(input.expectedResponse)
    if (
      !hasExactKeys(input, ['currentLifecycleGeneration', 'command', 'expectedResponse']) ||
      !SafeInteger.safeParse(input.currentLifecycleGeneration).success ||
      !command.success ||
      !response.success ||
      validCommandTime(command.data, validationTime) ||
      command.data.type !== 'cell-lifecycle-command' ||
      command.data.lifecycleGeneration >= (input.currentLifecycleGeneration as number) ||
      response.data.result !== 'STALE_NOOP' ||
      response.data.commandId !== command.data.commandId ||
      response.data.commandType !== command.data.commandType ||
      response.data.cellId !== command.data.cellId ||
      response.data.targetIncarnationId !== command.data.targetIncarnationId
    ) {
      return ['REJECT', 'INVALID_PRIVATE_COMMAND']
    }
    return ['ACCEPT', 'STALE_NOOP']
  }

  const commands = Array.isArray(input.commands) ? input.commands : []
  if (!hasExactKeys(input, ['commands']) || commands.length === 0) {
    return ['REJECT', 'INVALID_PRIVATE_COMMAND']
  }
  for (const value of commands) {
    const command = PrivateCommandSchema.safeParse(value)
    if (!command.success) {
      return ['REJECT', 'INVALID_PRIVATE_COMMAND']
    }
    const invalidTime = validCommandTime(command.data, validationTime)
    if (invalidTime) {
      return invalidTime
    }
  }
  return ['ACCEPT', 'VALID_PRIVATE_COMMAND']
}

export function evaluatePrivateStatus(
  input: Record<string, unknown>,
  validationTime: number
): HiveRelayContractVerdict {
  if (!hasExactKeys(input, ['auth', 'response'])) {
    return ['REJECT', 'INVALID_PRIVATE_STATUS']
  }
  const auth = StatusAuthSchema.safeParse(input.auth)
  const response = StatusResponseSchema.safeParse(input.response)
  if (!auth.success || !response.success) {
    return ['REJECT', 'INVALID_PRIVATE_STATUS']
  }
  if (auth.data.carrier !== 'private-https-authorization-header') {
    return ['REJECT', 'WRONG_TOKEN_CARRIER']
  }
  if (auth.data.method !== 'GET' || auth.data.path !== '/internal/status') {
    return ['REJECT', 'WRONG_OPERATION_BINDING']
  }
  if (!isCanonicalHiveRelayOrigin(auth.data.privateOrigin)) {
    return ['REJECT', 'WRONG_BINDING']
  }
  if (
    auth.data.usedTokenJtis.includes(auth.data.tokenJti) ||
    auth.data.usedNonces.includes(auth.data.tokenNonce)
  ) {
    return ['REJECT', 'CELL_OPS_REPLAY']
  }
  if (auth.data.tokenCellId !== response.data.cellId) {
    return ['REJECT', 'WRONG_BINDING']
  }
  if (
    auth.data.tokenNonce !== auth.data.headerNonce ||
    auth.data.tokenNonce !== response.data.nonce
  ) {
    return ['REJECT', 'WRONG_NONCE_BINDING']
  }
  if (response.data.observedAt < validationTime - 30_000) {
    return ['REJECT', 'STATUS_STALE']
  }
  if (response.data.observedAt > validationTime + 30_000) {
    return ['REJECT', 'STATUS_NOT_YET_VALID']
  }
  return ['ACCEPT', 'VALID_PRIVATE_STATUS']
}
