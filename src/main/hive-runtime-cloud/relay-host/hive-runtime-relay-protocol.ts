import { createHash } from 'node:crypto'
import { parseTree, printParseErrorCode, type Node as JsonNode } from 'jsonc-parser'
import { z } from 'zod'

// HiveRelay v2 transport; the frozen HiveCloud schemas remain authoritative.

export const HIVE_RELAY_HOST_CONTROL_PATH = '/v1/host/control'
export const HIVE_RELAY_HOST_DATA_PATH_PREFIX = '/v1/host/data/'
export const HIVE_RELAY_CLIENT_PATH_PREFIX = '/v1/connect/'

const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Epoch = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const Base64Url32Bytes = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const CompactJws = z
  .string()
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/)
  .max(8 * 1024)

export const HiveRelayBindingSchema = z
  .object({
    cellId: OpaqueId,
    cellIncarnationId: UuidV4,
    runtimeId: OpaqueId,
    runtimeBootId: UuidV4,
    authorityGeneration: Epoch,
    fencingEpoch: Epoch,
    leaseEpoch: Epoch,
    assignmentId: UuidV4,
    assignmentEpoch: Epoch,
    controlGeneration: Epoch,
    relayHostId: z.string().regex(/^[A-Za-z0-9_-]{16}$/)
  })
  .strict()

export type HiveRelayBinding = z.infer<typeof HiveRelayBindingSchema>

export type HiveRelayRuntimeTuple = Pick<
  HiveRelayBinding,
  'runtimeId' | 'runtimeBootId' | 'authorityGeneration' | 'fencingEpoch' | 'leaseEpoch'
>

export const HostHelloSchema = HiveRelayBindingSchema.extend({
  type: z.literal('host-hello'),
  v: z.literal(2),
  hostPublicKeyB64: Base64Url32Bytes,
  capabilities: z
    .array(z.literal('ticket-connect-v2'))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, 'capabilities must be unique')
}).strict()

export const HostChallengeSchema = z
  .object({
    type: z.literal('host-challenge'),
    v: z.literal(2),
    challengeId: OpaqueId,
    relayEphemeralPublicKeyB64: Base64Url32Bytes,
    nonceB64: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
    ciphertextB64: z
      .string()
      .min(1)
      .max(16 * 1024)
      .regex(/^[A-Za-z0-9_-]+$/),
    expiresAt: Epoch
  })
  .strict()

export const HostChallengeAckSchema = z
  .object({
    type: z.literal('host-challenge-ack'),
    v: z.literal(2),
    challengeId: OpaqueId,
    proofB64: Base64Url32Bytes
  })
  .strict()

export const HostHelloAckSchema = z
  .object({
    type: z.literal('host-hello-ack'),
    v: z.literal(2),
    controlGeneration: Epoch,
    leaseExpiresAt: Epoch
  })
  .strict()

export const ClientAdmissionSchema = z
  .object({
    type: z.literal('relay-auth'),
    v: z.literal(2),
    clientAdmissionToken: CompactJws,
    clientPublicKeyB64: Base64Url32Bytes
  })
  .strict()

export const ConnectionOpenSchema = z
  .object({
    type: z.literal('conn-open'),
    v: z.literal(2),
    kind: z.literal('ticket'),
    connId: OpaqueId,
    connTicket: Base64Url32Bytes,
    intentId: UuidV4,
    clientKeyHash: Base64Url32Bytes,
    assignmentEpoch: Epoch,
    controlGeneration: Epoch,
    attachDeadlineMs: z.number().int().positive().max(12_000)
  })
  .strict()

export const HostDataAuthSchema = z
  .object({
    type: z.literal('host-data-auth'),
    v: z.literal(2),
    connId: OpaqueId,
    connTicket: Base64Url32Bytes,
    assignmentEpoch: Epoch,
    controlGeneration: Epoch
  })
  .strict()

export const RelayHelloSchema = z
  .object({
    type: z.literal('relay-hello'),
    v: z.literal(2),
    connId: OpaqueId,
    cellId: OpaqueId,
    cellIncarnationId: UuidV4
  })
  .strict()

export const AuthRefreshSchema = z
  .object({ type: z.literal('auth-refresh'), v: z.literal(2), controlLease: CompactJws })
  .strict()

export const DrainSchema = z
  .object({
    type: z.literal('drain'),
    v: z.literal(2),
    deadlineMs: z.number().int().nonnegative().max(120_000),
    reason: z.enum(['INCARNATION_DRAIN', 'ASSIGNMENT_FENCE', 'CONTROL_LEASE_EXPIRED'])
  })
  .strict()

export const HostControlInboundSchema = z.discriminatedUnion('type', [
  HostChallengeSchema,
  HostHelloAckSchema,
  ConnectionOpenSchema,
  DrainSchema
])

export const HiveRelayWireMessageSchema = z.discriminatedUnion('type', [
  HostHelloSchema,
  HostChallengeSchema,
  HostChallengeAckSchema,
  HostHelloAckSchema,
  ClientAdmissionSchema,
  ConnectionOpenSchema,
  HostDataAuthSchema,
  RelayHelloSchema,
  AuthRefreshSchema,
  DrainSchema
])

export type AuthRefresh = z.infer<typeof AuthRefreshSchema>
export type HostHello = z.infer<typeof HostHelloSchema>
export type HostChallenge = z.infer<typeof HostChallengeSchema>
export type HostChallengeAck = z.infer<typeof HostChallengeAckSchema>
export type HostHelloAck = z.infer<typeof HostHelloAckSchema>
export type ClientAdmission = z.infer<typeof ClientAdmissionSchema>
export type ConnectionOpen = z.infer<typeof ConnectionOpenSchema>
export type HostDataAuth = z.infer<typeof HostDataAuthSchema>
export type RelayHello = z.infer<typeof RelayHelloSchema>
export type HostControlInbound = z.infer<typeof HostControlInboundSchema>

function rejectDuplicateKeys(node: JsonNode, location = '$'): void {
  if (node.type === 'object') {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const [keyNode, valueNode] = property.children ?? []
      const key = keyNode?.value
      if (typeof key !== 'string' || !valueNode) {
        throw new Error(`Malformed JSON property at ${location}`)
      }
      if (keys.has(key)) {
        throw new Error(`Duplicate JSON key at ${location}.${key}`)
      }
      keys.add(key)
      rejectDuplicateKeys(valueNode, `${location}.${key}`)
    }
    return
  }
  if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      rejectDuplicateKeys(child, `${location}[${index}]`)
    }
  }
}

export function parseStrictJson<T>(text: string, schema: z.ZodType<T>): T {
  const errors: { error: number; offset: number; length: number }[] = []
  const root = parseTree(text, errors, { allowTrailingComma: false, disallowComments: true })
  if (!root || errors.length > 0) {
    const detail = errors[0] ? printParseErrorCode(errors[0].error) : 'InvalidSymbol'
    throw new Error(`Invalid JSON: ${detail}`)
  }
  rejectDuplicateKeys(root)
  const result = schema.safeParse(JSON.parse(text) as unknown)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`Invalid message: ${issue?.path.join('.') || '$'}:${issue?.code ?? 'unknown'}`)
  }
  return result.data
}

export function encodeWireJson(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

export function deriveHiveRelayHostId(publicKey: Uint8Array): string {
  return createHash('sha256').update(publicKey).digest('base64url').slice(0, 16)
}

export function deriveHiveRelayKeyHash(publicKey: Uint8Array): string {
  return createHash('sha256').update(publicKey).digest('base64url')
}

function encodeLengthPrefixedField(name: string, value: Uint8Array): Buffer {
  const nameBytes = Buffer.from(name, 'ascii')
  const nameLength = Buffer.allocUnsafe(4)
  const valueLength = Buffer.allocUnsafe(4)
  nameLength.writeUInt32BE(nameBytes.byteLength)
  valueLength.writeUInt32BE(value.byteLength)
  return Buffer.concat([nameLength, nameBytes, valueLength, value])
}

function encodeUnsigned64(value: number): Buffer {
  const encoded = Buffer.allocUnsafe(8)
  encoded.writeBigUInt64BE(BigInt(value))
  return encoded
}

export function deriveHiveRelayRuntimeTupleHash(tuple: HiveRelayRuntimeTuple): string {
  const fields: [string, Uint8Array][] = [
    ['domain', Buffer.from('hive-relay-runtime-tuple/v2', 'ascii')],
    ['runtimeId', Buffer.from(tuple.runtimeId, 'ascii')],
    ['runtimeBootId', Buffer.from(tuple.runtimeBootId, 'ascii')],
    ['authorityGeneration', encodeUnsigned64(tuple.authorityGeneration)],
    ['fencingEpoch', encodeUnsigned64(tuple.fencingEpoch)],
    ['leaseEpoch', encodeUnsigned64(tuple.leaseEpoch)]
  ]
  const preimage = Buffer.concat(
    fields.map(([name, value]) => encodeLengthPrefixedField(name, value))
  )
  return createHash('sha256').update(preimage).digest('base64url')
}

export function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export function fromBase64Url(value: string, expectedBytes: number): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null
  }
  const bytes = Buffer.from(value, 'base64url')
  return bytes.byteLength === expectedBytes && bytes.toString('base64url') === value ? bytes : null
}
