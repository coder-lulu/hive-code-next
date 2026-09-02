import { z } from 'zod'

const Base64Url32 = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const FRAME_LIMIT_NAMES = [
  'preAuthJsonBytes',
  'hostControlJsonBytes',
  'jsonPlaintextBytes',
  'binaryPlaintextBytes',
  'encryptedPayloadBytes',
  'maskedWireMessageBytes'
] as const

const REQUIRED_CLOSE_CODE_SYMBOLS = new Set([
  'PROTOCOL_ERROR',
  'FRAME_TOO_LARGE',
  'SERVICE_RESTART',
  'CAPACITY_EXCEEDED',
  'AUTH_REQUIRED',
  'ORIGIN_REJECTED',
  'AUTH_TIMEOUT',
  'REPLAY_DETECTED',
  'STALE_BINDING',
  'HOST_UNAVAILABLE',
  'RELAY_UNAVAILABLE',
  'DRAINING',
  'UPGRADE_REQUIRED'
])

export type HiveRelayContractVerdict = ['ACCEPT' | 'REJECT', string]
type RulesContext = {
  frameLimits: Readonly<Record<string, number | boolean>>
  closeCodes: readonly { symbol: string; code: number }[]
}

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJsonValue(value, right[index]))
    )
  }
  const leftObject = object(left)
  const rightObject = object(right)
  if (!leftObject || !rightObject) {
    return false
  }
  const leftKeys = Object.keys(leftObject).sort()
  const rightKeys = Object.keys(rightObject).sort()
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJsonValue(leftObject[key], rightObject[key])
    )
  )
}

export function evaluateFrame(
  input: Record<string, unknown>,
  context: RulesContext
): HiveRelayContractVerdict {
  if (!Array.isArray(input.frames) || input.frames.length !== FRAME_LIMIT_NAMES.length) {
    return ['REJECT', 'INVALID_FRAME_LIMIT']
  }
  const seen = new Set<string>()
  let oversized = false
  for (const entry of input.frames) {
    const frame = object(entry)
    const limit = frame && typeof frame.limit === 'string' ? context.frameLimits[frame.limit] : null
    if (
      !frame ||
      !hasExactKeys(frame, ['limit', 'bytes']) ||
      typeof frame.limit !== 'string' ||
      !FRAME_LIMIT_NAMES.includes(frame.limit as (typeof FRAME_LIMIT_NAMES)[number]) ||
      seen.has(frame.limit) ||
      typeof frame.bytes !== 'number' ||
      !Number.isSafeInteger(frame.bytes) ||
      frame.bytes < 0 ||
      typeof limit !== 'number'
    ) {
      return ['REJECT', 'INVALID_FRAME_LIMIT']
    }
    seen.add(frame.limit)
    if (frame.bytes === limit + 1) {
      oversized = true
    } else if (frame.bytes !== limit) {
      return ['REJECT', 'INVALID_FRAME_LIMIT']
    }
  }
  if (oversized) {
    return hasExactKeys(input, ['frames', 'expectedCloseCode']) &&
      input.expectedCloseCode === context.frameLimits.oversizeCloseCode
      ? ['REJECT', 'FRAME_TOO_LARGE']
      : ['REJECT', 'INVALID_FRAME_LIMIT']
  }
  return hasExactKeys(input, ['frames', 'compressionRequested']) &&
    input.compressionRequested === false &&
    context.frameLimits.compressionEnabled === false
    ? ['ACCEPT', 'AT_LIMIT']
    : ['REJECT', 'COMPRESSION_FORBIDDEN']
}

export function evaluateCloseCodes(
  input: Record<string, unknown>,
  context: RulesContext
): HiveRelayContractVerdict {
  if (
    !hasExactKeys(input, ['mappings']) ||
    !Array.isArray(input.mappings) ||
    input.mappings.length !== REQUIRED_CLOSE_CODE_SYMBOLS.size
  ) {
    return ['REJECT', 'INVALID_CLOSE_CODE']
  }
  const registry = new Map(context.closeCodes.map((entry) => [entry.symbol, entry.code]))
  const seenSymbols = new Set<string>()
  const seenCodes = new Set<number>()
  const valid = input.mappings.every((entry) => {
    const mapping = object(entry)
    if (
      !mapping ||
      !hasExactKeys(mapping, ['symbol', 'code']) ||
      typeof mapping.symbol !== 'string' ||
      typeof mapping.code !== 'number' ||
      !Number.isSafeInteger(mapping.code) ||
      !REQUIRED_CLOSE_CODE_SYMBOLS.has(mapping.symbol) ||
      seenSymbols.has(mapping.symbol) ||
      seenCodes.has(mapping.code) ||
      registry.get(mapping.symbol) !== mapping.code
    ) {
      return false
    }
    seenSymbols.add(mapping.symbol)
    seenCodes.add(mapping.code)
    return true
  })
  return valid ? ['ACCEPT', 'VALID_CLOSE_CODES'] : ['REJECT', 'INVALID_CLOSE_CODE']
}

export function evaluateReplay(
  operation: 'admission-replay' | 'conn-ticket-replay',
  input: Record<string, unknown>
): HiveRelayContractVerdict {
  if (operation === 'conn-ticket-replay') {
    return hasExactKeys(input, ['connTicket', 'priorConsumed', 'concurrentAttempts']) &&
      Base64Url32.safeParse(input.connTicket).success &&
      input.priorConsumed === false &&
      input.concurrentAttempts === 1
      ? ['ACCEPT', 'FIRST_USE']
      : ['REJECT', 'REPLAY_DETECTED']
  }
  const expected = object(input.expected)
  const actual = object(input.actual)
  if ((expected || actual) && (!expected || !actual || !sameJsonValue(expected, actual))) {
    return ['REJECT', 'WRONG_BINDING']
  }
  return input.priorState === 'UNUSED' && input.attempts === 1
    ? ['ACCEPT', 'FIRST_USE']
    : ['REJECT', 'REPLAY_DETECTED']
}
