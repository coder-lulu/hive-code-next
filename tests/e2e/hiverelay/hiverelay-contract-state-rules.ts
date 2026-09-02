import { z } from 'zod'

const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
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
      rejectAssignmentEpochAtMost: Epoch,
      rejectControlGenerationAtMost: Epoch,
      issuedAt: Epoch
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
      lifecycleGeneration: Epoch,
      issuedAt: Epoch,
      deadlineAt: Epoch
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
      lifecycleGeneration: Epoch,
      issuedAt: Epoch
    })
    .strict()
])
const SessionTransitionSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    transitionId: UuidV4,
    transitionType: z.enum(['ACTIVATE', 'ABANDON', 'CLOSE', 'IDLE_EXPIRE', 'AUTHORITY_EXPIRE']),
    managedSessionId: z.string().min(1).max(128),
    runtimeSessionId: z.string().min(1).max(128),
    expectedControlVersion: Epoch,
    sessionBindingHash: Base64Url32,
    occurredAt: Epoch,
    reason: z.enum([
      'ACTIVATED',
      'ABANDONED_BEFORE_ACTIVATION',
      'CLIENT_CLOSED',
      'RUNTIME_SHUTDOWN',
      'TRANSPORT_CLOSED',
      'LOCAL_ERROR',
      'IDLE_TIMEOUT',
      'SESSION_AUTHORITY_TIMEOUT'
    ])
  })
  .strict()

type Verdict = ['ACCEPT' | 'REJECT', string]
type RulesContext = {
  frameLimits: Readonly<Record<string, number | boolean>>
  closeCodes: readonly { symbol: string; code: number }[]
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function evaluatePrivateCommand(input: Record<string, unknown>): Verdict {
  const previous = object(input.previous)
  const current = object(input.current)
  if (
    previous &&
    current &&
    previous.commandId === current.commandId &&
    previous.bodySha256 !== current.bodySha256
  ) {
    return ['REJECT', 'COMMAND_REPLAY_CONFLICT']
  }
  const commands = Array.isArray(input.commands) ? input.commands : []
  return commands.length > 0 &&
    commands.every((command) => PrivateCommandSchema.safeParse(command).success)
    ? ['ACCEPT', 'VALID_PRIVATE_COMMAND']
    : ['REJECT', 'INVALID_PRIVATE_COMMAND']
}

export function evaluateSession(input: Record<string, unknown>): Verdict {
  const stored = object(input.stored)
  const replay = object(input.replay)
  if (
    stored &&
    replay &&
    stored.sequence === replay.sequence &&
    stored.transitionId === replay.transitionId &&
    stored.bodySha256 !== replay.bodySha256
  ) {
    return ['REJECT', 'TRANSITION_REPLAY_CONFLICT']
  }
  const transition = SessionTransitionSchema.safeParse(input.transition)
  if (!transition.success || typeof input.highestContiguousAck !== 'number') {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  if (transition.data.sequence !== input.highestContiguousAck + 1) {
    return ['REJECT', 'SEQUENCE_GAP']
  }
  if (
    transition.data.expectedControlVersion !== input.currentControlVersion ||
    (transition.data.transitionType === 'ACTIVATE' && input.currentStatus !== 'PENDING_ACTIVATION')
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  return ['ACCEPT', 'VALID_SESSION_TRANSITION']
}

export function evaluateFrame(input: Record<string, unknown>, context: RulesContext): Verdict {
  if (!Array.isArray(input.frames)) {
    return ['REJECT', 'INVALID_FRAME_LIMIT']
  }
  for (const entry of input.frames) {
    const frame = object(entry)
    const limit = frame && typeof frame.limit === 'string' ? context.frameLimits[frame.limit] : null
    if (!frame || typeof frame.bytes !== 'number' || typeof limit !== 'number') {
      return ['REJECT', 'INVALID_FRAME_LIMIT']
    }
    if (frame.bytes > limit) {
      return ['REJECT', 'FRAME_TOO_LARGE']
    }
  }
  return input.compressionRequested === true || context.frameLimits.compressionEnabled !== false
    ? ['REJECT', 'COMPRESSION_FORBIDDEN']
    : ['ACCEPT', 'AT_LIMIT']
}

export function evaluateCloseCodes(input: Record<string, unknown>, context: RulesContext): Verdict {
  if (!Array.isArray(input.mappings)) {
    return ['REJECT', 'INVALID_CLOSE_CODE']
  }
  const registry = new Map(context.closeCodes.map((entry) => [entry.symbol, entry.code]))
  const valid = input.mappings.every((entry) => {
    const mapping = object(entry)
    return (
      mapping &&
      typeof mapping.symbol === 'string' &&
      typeof mapping.code === 'number' &&
      registry.get(mapping.symbol) === mapping.code
    )
  })
  return valid ? ['ACCEPT', 'VALID_CLOSE_CODES'] : ['REJECT', 'INVALID_CLOSE_CODE']
}

export function evaluateReplay(
  operation: 'admission-replay' | 'conn-ticket-replay',
  input: Record<string, unknown>
): Verdict {
  if (operation === 'conn-ticket-replay') {
    return input.priorConsumed === false && input.concurrentAttempts === 1
      ? ['ACCEPT', 'FIRST_USE']
      : ['REJECT', 'REPLAY_DETECTED']
  }
  const expected = object(input.expected)
  const actual = object(input.actual)
  if (expected && actual && JSON.stringify(expected) !== JSON.stringify(actual)) {
    return ['REJECT', 'WRONG_BINDING']
  }
  return input.priorState === 'UNUSED' && input.attempts === 1
    ? ['ACCEPT', 'FIRST_USE']
    : ['REJECT', 'REPLAY_DETECTED']
}
