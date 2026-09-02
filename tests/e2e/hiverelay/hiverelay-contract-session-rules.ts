import { z } from 'zod'
import {
  hasExactKeys,
  object,
  sameJsonValue,
  type HiveRelayContractVerdict
} from './hiverelay-contract-state-rules'

const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)

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

const SessionReplayRecordSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    transitionId: UuidV4,
    bodySha256: Sha256Hex
  })
  .strict()

const SessionStatusSchema = z.enum([
  'PENDING_ACTIVATION',
  'ACTIVE',
  'CLOSED',
  'EXPIRED',
  'UNVERIFIABLE',
  'REVOKE_PENDING',
  'REVOKED'
])

const SessionAdjudicationSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    transitionId: UuidV4,
    verdict: z.enum([
      'APPLIED',
      'REJECTED_NOT_FOUND',
      'REJECTED_BINDING',
      'REJECTED_STALE_VERSION',
      'REJECTED_ILLEGAL_STATE',
      'REJECTED_DEADLINE',
      'REJECTED_AUTHORITY',
      'TRANSITION_REPLAY_CONFLICT',
      'SEQUENCE_GAP'
    ]),
    stored: z.boolean(),
    resultingStatus: SessionStatusSchema,
    resultingControlVersion: Epoch
  })
  .strict()

const StoredSessionReplayRecordSchema = SessionReplayRecordSchema.extend({
  adjudication: SessionAdjudicationSchema.optional()
}).strict()

const SESSION_RULES = {
  ACTIVATE: { sources: ['PENDING_ACTIVATION'], reasons: ['ACTIVATED'], target: 'ACTIVE' },
  ABANDON: {
    sources: ['PENDING_ACTIVATION'],
    reasons: ['ABANDONED_BEFORE_ACTIVATION'],
    target: 'CLOSED'
  },
  CLOSE: {
    sources: ['ACTIVE'],
    reasons: ['CLIENT_CLOSED', 'RUNTIME_SHUTDOWN', 'TRANSPORT_CLOSED', 'LOCAL_ERROR'],
    target: 'CLOSED'
  },
  IDLE_EXPIRE: { sources: ['ACTIVE'], reasons: ['IDLE_TIMEOUT'], target: 'EXPIRED' },
  AUTHORITY_EXPIRE: {
    sources: ['ACTIVE', 'REVOKE_PENDING'],
    reasons: ['SESSION_AUTHORITY_TIMEOUT'],
    target: 'UNVERIFIABLE'
  }
} as const

const STORED_VERDICTS = new Set([
  'APPLIED',
  'REJECTED_NOT_FOUND',
  'REJECTED_BINDING',
  'REJECTED_STALE_VERSION',
  'REJECTED_ILLEGAL_STATE',
  'REJECTED_DEADLINE',
  'REJECTED_AUTHORITY'
])

export function evaluateSession(input: Record<string, unknown>): HiveRelayContractVerdict {
  if (input.stored !== undefined || input.replay !== undefined) {
    if (
      !hasExactKeys(input, [
        'highestContiguousAck',
        'stored',
        'replay',
        ...(input.expectedHighestContiguousAck === undefined
          ? []
          : ['expectedHighestContiguousAck'])
      ])
    ) {
      return ['REJECT', 'INVALID_SESSION_TRANSITION']
    }
    const stored = StoredSessionReplayRecordSchema.safeParse(input.stored)
    const replay = SessionReplayRecordSchema.safeParse(input.replay)
    const highestContiguousAck = Epoch.safeParse(input.highestContiguousAck)
    if (!stored.success || !replay.success || !highestContiguousAck.success) {
      return ['REJECT', 'INVALID_SESSION_TRANSITION']
    }
    const sameSequence = stored.data.sequence === replay.data.sequence
    const sameTransitionId = stored.data.transitionId === replay.data.transitionId
    const exactReplay =
      sameSequence && sameTransitionId && stored.data.bodySha256 === replay.data.bodySha256
    if (!exactReplay) {
      return sameSequence || sameTransitionId
        ? ['REJECT', 'TRANSITION_REPLAY_CONFLICT']
        : ['REJECT', 'INVALID_SESSION_TRANSITION']
    }
    const adjudication = stored.data.adjudication
    if (
      !adjudication ||
      adjudication.sequence !== stored.data.sequence ||
      adjudication.transitionId !== stored.data.transitionId ||
      adjudication.stored !== true ||
      !STORED_VERDICTS.has(adjudication.verdict) ||
      input.expectedHighestContiguousAck !== highestContiguousAck.data ||
      highestContiguousAck.data < stored.data.sequence
    ) {
      return ['REJECT', 'INVALID_SESSION_TRANSITION']
    }
    return ['ACCEPT', 'STORED_ADJUDICATION']
  }

  if (input.transitions !== undefined) {
    return evaluateBatch(input)
  }
  return evaluateSingle(input)
}

function evaluateBatch(input: Record<string, unknown>): HiveRelayContractVerdict {
  if (
    !hasExactKeys(input, [
      'highestContiguousAck',
      'currentStatus',
      'currentControlVersion',
      'transitions',
      'expectedResponse'
    ]) ||
    !Array.isArray(input.transitions) ||
    input.transitions.length === 0 ||
    input.transitions.length > 128
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  const ack = Epoch.safeParse(input.highestContiguousAck)
  const controlVersion = Epoch.safeParse(input.currentControlVersion)
  const status = SessionStatusSchema.safeParse(input.currentStatus)
  const expectedResponse = object(input.expectedResponse)
  if (!ack.success || !controlVersion.success || !status.success || !expectedResponse) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  let currentAck = ack.data
  let currentControlVersion = controlVersion.data
  let currentStatus: z.infer<typeof SessionStatusSchema> = status.data
  let stopped = false
  const adjudications: z.infer<typeof SessionAdjudicationSchema>[] = []
  for (const value of input.transitions) {
    const parsed = SessionTransitionSchema.safeParse(value)
    if (!parsed.success) {
      return ['REJECT', 'INVALID_SESSION_TRANSITION']
    }
    const transition = parsed.data
    const rule = SESSION_RULES[transition.transitionType]
    let verdict: z.infer<typeof SessionAdjudicationSchema>['verdict']
    let stored: boolean
    if (stopped || transition.sequence !== currentAck + 1) {
      verdict = 'SEQUENCE_GAP'
      stored = false
      stopped = true
    } else if (!(rule.reasons as readonly string[]).includes(transition.reason)) {
      return ['REJECT', 'INVALID_TRANSITION_REASON']
    } else if (transition.expectedControlVersion !== currentControlVersion) {
      verdict = 'REJECTED_STALE_VERSION'
      stored = true
      currentAck = transition.sequence
    } else if (!(rule.sources as readonly string[]).includes(currentStatus)) {
      verdict = 'REJECTED_ILLEGAL_STATE'
      stored = true
      currentAck = transition.sequence
    } else {
      verdict = 'APPLIED'
      stored = true
      currentAck = transition.sequence
      currentStatus = rule.target
      currentControlVersion += 1
    }
    adjudications.push({
      sequence: transition.sequence,
      transitionId: transition.transitionId,
      verdict,
      stored,
      resultingStatus: currentStatus,
      resultingControlVersion: currentControlVersion
    })
  }
  const actualResponse = { highestContiguousAck: currentAck, adjudications }
  if (
    !hasExactKeys(expectedResponse, ['highestContiguousAck', 'adjudications']) ||
    !Array.isArray(expectedResponse.adjudications) ||
    !expectedResponse.adjudications.every(
      (value) => SessionAdjudicationSchema.safeParse(value).success
    ) ||
    !sameJsonValue(actualResponse, expectedResponse)
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  return stopped ? ['REJECT', 'SEQUENCE_GAP'] : ['ACCEPT', 'VALID_SESSION_TRANSITION_BATCH']
}

function evaluateSingle(input: Record<string, unknown>): HiveRelayContractVerdict {
  if (
    !hasExactKeys(input, [
      'highestContiguousAck',
      'currentStatus',
      'currentControlVersion',
      'transition'
    ])
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  const transition = SessionTransitionSchema.safeParse(input.transition)
  const highestContiguousAck = Epoch.safeParse(input.highestContiguousAck)
  const currentControlVersion = Epoch.safeParse(input.currentControlVersion)
  const currentStatus = SessionStatusSchema.safeParse(input.currentStatus)
  if (
    !transition.success ||
    !highestContiguousAck.success ||
    !currentControlVersion.success ||
    !currentStatus.success
  ) {
    return ['REJECT', 'INVALID_SESSION_TRANSITION']
  }
  if (transition.data.sequence !== highestContiguousAck.data + 1) {
    return ['REJECT', 'SEQUENCE_GAP']
  }
  const rule = SESSION_RULES[transition.data.transitionType]
  if (!(rule.reasons as readonly string[]).includes(transition.data.reason)) {
    return ['REJECT', 'INVALID_TRANSITION_REASON']
  }
  if (transition.data.expectedControlVersion !== currentControlVersion.data) {
    return ['REJECT', 'STALE_CONTROL_VERSION']
  }
  if (!(rule.sources as readonly string[]).includes(currentStatus.data)) {
    return ['REJECT', 'REJECTED_ILLEGAL_STATE']
  }
  return ['ACCEPT', 'VALID_SESSION_TRANSITION']
}
