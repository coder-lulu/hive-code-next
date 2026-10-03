import { createHash } from 'node:crypto'
import nacl from 'tweetnacl'
import { z } from 'zod'
import { fromBase64Url } from './hiverelay-test-wire'

const SafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const OpaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
const UuidV4 = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/)
const RuntimeTupleSchema = z
  .object({
    runtimeId: OpaqueId,
    runtimeBootId: UuidV4,
    authorityGeneration: SafeInteger,
    fencingEpoch: SafeInteger,
    leaseEpoch: SafeInteger
  })
  .strict()
const RuntimeProofSchema = RuntimeTupleSchema.extend({
  protocolVersion: z.literal('hive-relay-runtime-proof/v2'),
  algorithm: z.literal('Ed25519'),
  method: z.literal('POST'),
  path: z
    .string()
    .min(1)
    .max(512)
    .regex(/^\/[^?#]*$/),
  authorityId: OpaqueId,
  issuedAt: SafeInteger,
  nonce: UuidV4,
  bodySha256: Sha256Hex,
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/)
}).strict()
const VerifierContextSchema = z
  .object({
    expectedCarrier: z.literal('json-body.runtimeProof'),
    presentedCarrier: z.string().min(1),
    method: z.literal('POST'),
    path: z
      .string()
      .min(1)
      .max(512)
      .regex(/^\/[^?#]*$/),
    authorityId: OpaqueId,
    runtimeIdentityPublicKeyB64Url: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    currentRuntimeTuple: RuntimeTupleSchema,
    usedNonceDigests: z.array(Sha256Hex).refine((values) => new Set(values).size === values.length)
  })
  .strict()

type Verdict = ['ACCEPT' | 'REJECT', string]

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  throw new Error('value is outside the frozen Runtime proof JCS profile')
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function signingInput(proof: z.infer<typeof RuntimeProofSchema>): Uint8Array {
  return Buffer.from(
    [
      proof.protocolVersion,
      proof.algorithm,
      proof.method,
      proof.path,
      proof.authorityId,
      proof.runtimeId,
      proof.runtimeBootId,
      String(proof.authorityGeneration),
      String(proof.fencingEpoch),
      String(proof.leaseEpoch),
      String(proof.issuedAt),
      proof.nonce,
      proof.bodySha256
    ].join('\n'),
    'utf8'
  )
}

export function evaluateRuntimeProof(
  input: Record<string, unknown>,
  validationTime: number
): Verdict {
  if (
    Object.keys(input).sort().join(',') !==
    ['protectedPayload', 'runtimeProof', 'verifierContext'].sort().join(',')
  ) {
    return ['REJECT', 'INVALID_RUNTIME_PROOF']
  }
  const context = VerifierContextSchema.safeParse(input.verifierContext)
  if (!context.success) {
    return ['REJECT', 'INVALID_RUNTIME_PROOF']
  }
  if (context.data.presentedCarrier !== context.data.expectedCarrier) {
    return ['REJECT', 'INVALID_RUNTIME_PROOF_CARRIER']
  }
  const proof = RuntimeProofSchema.safeParse(input.runtimeProof)
  if (!proof.success || !input.protectedPayload || typeof input.protectedPayload !== 'object') {
    return ['REJECT', 'INVALID_RUNTIME_PROOF']
  }
  const tuple = context.data.currentRuntimeTuple
  if (
    proof.data.method !== context.data.method ||
    proof.data.path !== context.data.path ||
    proof.data.authorityId !== context.data.authorityId ||
    proof.data.runtimeId !== tuple.runtimeId ||
    proof.data.runtimeBootId !== tuple.runtimeBootId ||
    proof.data.authorityGeneration !== tuple.authorityGeneration ||
    proof.data.fencingEpoch !== tuple.fencingEpoch ||
    proof.data.leaseEpoch !== tuple.leaseEpoch
  ) {
    return ['REJECT', 'WRONG_BINDING']
  }
  const payload = input.protectedPayload as Record<string, unknown>
  for (const field of [
    'runtimeId',
    'runtimeBootId',
    'authorityGeneration',
    'fencingEpoch',
    'leaseEpoch'
  ] as const) {
    if (Object.hasOwn(payload, field) && payload[field] !== proof.data[field]) {
      return ['REJECT', 'WRONG_BINDING']
    }
  }
  let bodySha256: string
  try {
    bodySha256 = sha256(canonicalJson(payload))
  } catch {
    return ['REJECT', 'INVALID_RUNTIME_PROOF']
  }
  if (bodySha256 !== proof.data.bodySha256) {
    return ['REJECT', 'RUNTIME_PROOF_BODY_MISMATCH']
  }
  if (proof.data.issuedAt > validationTime + 30_000) {
    return ['REJECT', 'RUNTIME_PROOF_NOT_YET_VALID']
  }
  if (validationTime > proof.data.issuedAt + 60_000 + 30_000) {
    return ['REJECT', 'RUNTIME_PROOF_EXPIRED']
  }
  const nonceDigest = sha256(
    `hive-relay-runtime-proof-nonce/v2\n${proof.data.runtimeId}\n${proof.data.nonce}`
  )
  if (context.data.usedNonceDigests.includes(nonceDigest)) {
    return ['REJECT', 'RUNTIME_PROOF_REPLAY']
  }
  const publicKey = fromBase64Url(context.data.runtimeIdentityPublicKeyB64Url, 32)
  const signature = fromBase64Url(proof.data.signature, 64)
  if (
    !publicKey ||
    !signature ||
    !nacl.sign.detached.verify(signingInput(proof.data), signature, publicKey)
  ) {
    return ['REJECT', 'INVALID_RUNTIME_PROOF_SIGNATURE']
  }
  return ['ACCEPT', 'VALID_RUNTIME_PROOF']
}
