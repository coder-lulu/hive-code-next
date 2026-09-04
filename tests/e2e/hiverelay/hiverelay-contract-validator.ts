import nacl from 'tweetnacl'
import { z } from 'zod'
import { RelayConnectionOpenMessageSchema } from '../../../src/main/runtime/relay/relay-control-protocol'
import {
  HiveRelayWireMessageSchema,
  deriveHiveRelayHostId,
  deriveHiveRelayRuntimeTupleHash,
  fromBase64Url,
  parseStrictJson
} from './hiverelay-test-wire'
import { validateFixtureJws } from './hiverelay-contract-jws'
import { isCanonicalHiveRelayOrigin } from './hiverelay-contract-origin'
import { evaluateRuntimeProof } from './hiverelay-contract-runtime-proof'
import { evaluateSession } from './hiverelay-contract-session-rules'
import { evaluatePrivateCommand, evaluatePrivateStatus } from './hiverelay-contract-private-ops'
import { evaluateCloseCodes, evaluateFrame, evaluateReplay } from './hiverelay-contract-state-rules'

const Operation = z.enum([
  'legacy-bytes',
  'wire-message',
  'jws',
  'runtime-proof',
  'runtime-tuple-hash',
  'origin',
  'x25519-key',
  'private-command',
  'private-status',
  'session-transition',
  'close-code',
  'frame-limit',
  'admission-replay',
  'conn-ticket-replay'
])
const ContractFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    contractRevision: z.string().min(1),
    caseId: z.string().min(1).max(128),
    suite: z.enum(['legacy-v1-byte-regression', 'hiverelay-v2-conformance']),
    operation: Operation,
    applicableComponents: z.array(z.enum(['cloud', 'hivecode', 'cell', 'legacy-orca'])).min(1),
    validationTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    input: z.record(z.string(), z.unknown())
  })
  .strict()

export type HiveRelayContractFixture = z.infer<typeof ContractFixtureSchema>
export type HiveRelayContractResult = {
  caseId: string
  verdict: 'ACCEPT' | 'REJECT' | 'NOT_APPLICABLE'
  reason: string
}
export type HiveRelayContractContext = {
  clockSkewSeconds: number
  frameLimits: Readonly<Record<string, number | boolean>>
  testKeys: readonly {
    kid: string
    purpose: string
    alg: string
    curve: string
    publicKeyB64Url: string
  }[]
  closeCodes: readonly { symbol: string; code: number }[]
  credentials: readonly { name: string; lifetimeSeconds: number }[]
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function result(
  fixture: HiveRelayContractFixture,
  verdict: HiveRelayContractResult['verdict'],
  reason: string
): HiveRelayContractResult {
  return { caseId: fixture.caseId, verdict, reason }
}

function evaluateLegacy(input: Record<string, unknown>): ['ACCEPT' | 'REJECT', string] {
  const message = object(input.message)
  if (!message || typeof input.rawBase64 !== 'string') {
    return ['REJECT', 'INVALID_LEGACY_BYTES']
  }
  const raw = Buffer.from(input.rawBase64, 'base64')
  const currentWireBytes = Buffer.from(JSON.stringify(message))
  const valid =
    raw.equals(currentWireBytes) && RelayConnectionOpenMessageSchema.safeParse(message).success
  return valid ? ['ACCEPT', 'VALID_LEGACY_BYTES'] : ['REJECT', 'INVALID_LEGACY_BYTES']
}

function containsForbiddenField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(containsForbiddenField)
  }
  const record = object(value)
  if (!record) {
    return false
  }
  const forbidden = new Set(['ticketSecret', 'ticketId', 'relayDeviceId', 'deviceToken'])
  return Object.entries(record).some(
    ([key, child]) => forbidden.has(key) || containsForbiddenField(child)
  )
}

function evaluateWire(input: Record<string, unknown>): ['ACCEPT' | 'REJECT', string] {
  if (typeof input.rawJson === 'string') {
    try {
      parseStrictJson(input.rawJson, HiveRelayWireMessageSchema)
      return ['ACCEPT', 'VALID_WIRE_MESSAGE']
    } catch (error) {
      return [
        'REJECT',
        error instanceof Error && error.message.includes('Duplicate JSON key')
          ? 'DUPLICATE_KEY'
          : 'INVALID_WIRE_MESSAGE'
      ]
    }
  }
  const messages = Array.isArray(input.messages) ? input.messages : [input.message]
  if (containsForbiddenField(messages)) {
    return ['REJECT', 'FORBIDDEN_FIELD']
  }
  for (const message of messages) {
    const parsed = HiveRelayWireMessageSchema.safeParse(message)
    if (!parsed.success) {
      const record = object(message)
      const padded = record
        ? Object.entries(record).some(
            ([key, value]) =>
              /(?:B64|Ticket|Hash)$/.test(key) && typeof value === 'string' && value.includes('=')
          )
        : false
      return [
        'REJECT',
        padded
          ? 'NON_CANONICAL_BASE64URL'
          : parsed.error.issues.some((issue) => issue.code === 'unrecognized_keys')
            ? 'UNKNOWN_FIELD'
            : 'INVALID_WIRE_MESSAGE'
      ]
    }
  }
  return ['ACCEPT', 'VALID_WIRE_MESSAGE']
}

function evaluateJws(
  fixture: HiveRelayContractFixture,
  context: HiveRelayContractContext
): ['ACCEPT' | 'REJECT', string] {
  const tokens = Array.isArray(fixture.input.tokens) ? fixture.input.tokens : [fixture.input]
  for (const entry of tokens) {
    const token = object(entry)
    if (!token || typeof token.tokenType !== 'string' || typeof token.compactJws !== 'string') {
      return ['REJECT', 'INVALID_JWS']
    }
    const reason = validateFixtureJws({
      tokenType: token.tokenType,
      compactJws: token.compactJws,
      validationTime: fixture.validationTime,
      clockSkewSeconds: context.clockSkewSeconds,
      lifetimeSeconds:
        context.credentials.find((credential) => credential.name === token.tokenType)
          ?.lifetimeSeconds ?? -1,
      keys: context.testKeys,
      verifierContext: fixture.input.verifierContext
    })
    if (reason !== 'VALID_JWS') {
      return ['REJECT', reason]
    }
  }
  return ['ACCEPT', 'VALID_JWS']
}

function evaluateOrigin(input: Record<string, unknown>): ['ACCEPT' | 'REJECT', string] {
  if (
    Object.keys(input).sort().join(',') !== ['allowedOrigins', 'browser', 'origin'].join(',') ||
    typeof input.origin !== 'string' ||
    input.browser !== true ||
    !Array.isArray(input.allowedOrigins) ||
    input.allowedOrigins.length === 0 ||
    input.allowedOrigins.some((origin) => typeof origin !== 'string')
  ) {
    return ['REJECT', 'INVALID_ORIGIN']
  }
  const allowedOrigins = input.allowedOrigins as string[]
  const valid =
    isCanonicalHiveRelayOrigin(input.origin) &&
    allowedOrigins.every(isCanonicalHiveRelayOrigin) &&
    allowedOrigins.includes(input.origin)
  return valid ? ['ACCEPT', 'VALID_ORIGIN'] : ['REJECT', 'INVALID_ORIGIN']
}

function evaluateX25519(input: Record<string, unknown>): ['ACCEPT' | 'REJECT', string] {
  if (typeof input.publicKeyB64Url !== 'string' || typeof input.relayHostId !== 'string') {
    return ['REJECT', 'INVALID_X25519_KEY']
  }
  const publicKey = fromBase64Url(input.publicKeyB64Url, 32)
  if (!publicKey) {
    return ['REJECT', 'INVALID_X25519_KEY']
  }
  const shared = nacl.scalarMult(new Uint8Array(32).fill(7), publicKey)
  if (shared.every((byte) => byte === 0)) {
    return ['REJECT', 'LOW_ORDER_X25519']
  }
  return deriveHiveRelayHostId(publicKey) === input.relayHostId
    ? ['ACCEPT', 'VALID_X25519_KEY']
    : ['REJECT', 'WRONG_RELAY_HOST_ID']
}

const RuntimeTupleHashInput = z
  .object({
    runtimeId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    runtimeBootId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    authorityGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    fencingEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    leaseEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    runtimeTupleHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
  })
  .strict()

function evaluateRuntimeTupleHash(input: Record<string, unknown>): ['ACCEPT' | 'REJECT', string] {
  const parsed = RuntimeTupleHashInput.safeParse(input)
  if (!parsed.success) {
    return ['REJECT', 'INVALID_RUNTIME_TUPLE_HASH']
  }
  const { runtimeTupleHash, ...tuple } = parsed.data
  return deriveHiveRelayRuntimeTupleHash(tuple) === runtimeTupleHash
    ? ['ACCEPT', 'VALID_RUNTIME_TUPLE_HASH']
    : ['REJECT', 'WRONG_BINDING']
}

export function parseHiveRelayContractFixture(raw: string): HiveRelayContractFixture {
  return parseStrictJson(raw, ContractFixtureSchema)
}

export function evaluateHiveRelayContractFixture(
  fixture: HiveRelayContractFixture,
  context: HiveRelayContractContext,
  component = 'hivecode'
): HiveRelayContractResult {
  if (!fixture.applicableComponents.includes(component as 'hivecode')) {
    return result(fixture, 'NOT_APPLICABLE', 'COMPONENT_NOT_APPLICABLE')
  }
  const evaluated = (() => {
    switch (fixture.operation) {
      case 'legacy-bytes':
        return evaluateLegacy(fixture.input)
      case 'wire-message':
        return evaluateWire(fixture.input)
      case 'jws':
        return evaluateJws(fixture, context)
      case 'runtime-proof':
        return evaluateRuntimeProof(fixture.input, fixture.validationTime)
      case 'runtime-tuple-hash':
        return evaluateRuntimeTupleHash(fixture.input)
      case 'origin':
        return evaluateOrigin(fixture.input)
      case 'x25519-key':
        return evaluateX25519(fixture.input)
      case 'private-command':
        return evaluatePrivateCommand(fixture.input, fixture.validationTime)
      case 'private-status':
        return evaluatePrivateStatus(fixture.input, fixture.validationTime)
      case 'session-transition':
        return evaluateSession(fixture.input)
      case 'frame-limit':
        return evaluateFrame(fixture.input, context)
      case 'close-code':
        return evaluateCloseCodes(fixture.input, context)
      case 'admission-replay':
      case 'conn-ticket-replay':
        return evaluateReplay(fixture.operation, fixture.input)
    }
  })()
  return result(fixture, evaluated[0], evaluated[1])
}
