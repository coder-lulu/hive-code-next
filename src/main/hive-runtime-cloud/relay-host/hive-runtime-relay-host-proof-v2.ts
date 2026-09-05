import { createHmac, timingSafeEqual } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  fromBase64Url,
  type HiveRelayBinding,
  type HostChallenge,
  type HostChallengeAck
} from './hive-runtime-relay-protocol'

const HOST_PROOF_DOMAIN = 'hive-relay-host-proof/v2'
const HOST_CHALLENGE_DOMAIN = 'hive-relay-host-challenge/v2'
const MAX_CHALLENGE_WINDOW_MS = 10_000
const CLOCK_SKEW_MS = 30_000
const encoder = new TextEncoder()

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  return bytes
}

function uint64(value: number): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false)
  return bytes
}

function field(name: string, value: Uint8Array): Uint8Array {
  const encodedName = encoder.encode(name)
  return concat([uint32(encodedName.byteLength), encodedName, uint32(value.byteLength), value])
}

function text(value: string): Uint8Array {
  return encoder.encode(value)
}

type TranscriptInput = {
  cellOrigin: string
  binding: HiveRelayBinding
  hostPublicKey: Uint8Array
  relayEphemeralPublicKey: Uint8Array
  challengeNonce: Uint8Array
  challengeId: string
  issuedAt: number
  expiresAt: number
}

export function encodeHostProofTranscript(input: TranscriptInput): Uint8Array {
  const { binding } = input
  return concat([
    field('protocol', text(HOST_PROOF_DOMAIN)),
    field('version', new Uint8Array([2])),
    field('cellOrigin', text(input.cellOrigin)),
    field('cellId', text(binding.cellId)),
    field('cellIncarnationId', text(binding.cellIncarnationId)),
    field('relayEphemeralPublicKey', input.relayEphemeralPublicKey),
    field('challengeNonce', input.challengeNonce),
    field('challengeId', text(input.challengeId)),
    field('issuedAt', uint64(input.issuedAt)),
    field('expiresAt', uint64(input.expiresAt)),
    field('runtimeId', text(binding.runtimeId)),
    field('runtimeBootId', text(binding.runtimeBootId)),
    field('authorityGeneration', uint64(binding.authorityGeneration)),
    field('fencingEpoch', uint64(binding.fencingEpoch)),
    field('leaseEpoch', uint64(binding.leaseEpoch)),
    field('assignmentId', text(binding.assignmentId)),
    field('assignmentEpoch', uint64(binding.assignmentEpoch)),
    field('controlGeneration', uint64(binding.controlGeneration)),
    field('relayHostId', text(binding.relayHostId)),
    field('hostPublicKey', input.hostPublicKey)
  ])
}

function readTranscriptFields(transcript: Uint8Array): Map<string, Uint8Array> | null {
  const result = new Map<string, Uint8Array>()
  const view = new DataView(transcript.buffer, transcript.byteOffset, transcript.byteLength)
  let offset = 0
  try {
    while (offset < transcript.byteLength) {
      const nameLength = view.getUint32(offset, false)
      offset += 4
      const nameEnd = offset + nameLength
      const name = new TextDecoder().decode(transcript.slice(offset, nameEnd))
      offset = nameEnd
      const valueLength = view.getUint32(offset, false)
      offset += 4
      const valueEnd = offset + valueLength
      if (result.has(name) || valueEnd > transcript.byteLength) {
        return null
      }
      result.set(name, transcript.slice(offset, valueEnd))
      offset = valueEnd
    }
  } catch {
    return null
  }
  return offset === transcript.byteLength ? result : null
}

function readUint64(value: Uint8Array | undefined): number | null {
  if (!value || value.byteLength !== 8) {
    return null
  }
  const parsed = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(
    0,
    false
  )
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : null
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

export function answerHostChallenge(args: {
  challenge: HostChallenge
  binding: HiveRelayBinding
  cellOrigin: string
  hostPublicKey: Uint8Array
  hostSecretKey: Uint8Array
  now: number
}): HostChallengeAck | null {
  const relayKey = fromBase64Url(args.challenge.relayEphemeralPublicKeyB64, 32)
  const nonce = fromBase64Url(args.challenge.nonceB64, 24)
  const ciphertext = Buffer.from(args.challenge.ciphertextB64, 'base64url')
  if (!relayKey || !nonce || ciphertext.toString('base64url') !== args.challenge.ciphertextB64) {
    return null
  }
  const plaintext = nacl.box.open(ciphertext, nonce, relayKey, args.hostSecretKey)
  const domain = text(`${HOST_CHALLENGE_DOMAIN}\0`)
  if (!plaintext || plaintext.byteLength < domain.byteLength + 4 + 32) {
    return null
  }
  if (!equal(plaintext.slice(0, domain.byteLength), domain)) {
    return null
  }
  const transcriptLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset + domain.byteLength,
    4
  ).getUint32(0, false)
  const transcriptStart = domain.byteLength + 4
  const secretStart = transcriptStart + transcriptLength
  if (secretStart + 32 !== plaintext.byteLength) {
    return null
  }
  const transcript = plaintext.slice(transcriptStart, secretStart)
  const fields = readTranscriptFields(transcript)
  const issuedAt = readUint64(fields?.get('issuedAt'))
  const expiresAt = readUint64(fields?.get('expiresAt'))
  if (
    issuedAt === null ||
    expiresAt !== args.challenge.expiresAt ||
    issuedAt > args.now + CLOCK_SKEW_MS ||
    args.now > expiresAt + CLOCK_SKEW_MS ||
    expiresAt - issuedAt !== MAX_CHALLENGE_WINDOW_MS
  ) {
    return null
  }
  const expectedTranscript = encodeHostProofTranscript({
    cellOrigin: args.cellOrigin,
    binding: args.binding,
    hostPublicKey: args.hostPublicKey,
    relayEphemeralPublicKey: relayKey,
    challengeNonce: nonce,
    challengeId: args.challenge.challengeId,
    issuedAt,
    expiresAt
  })
  if (!equal(transcript, expectedTranscript)) {
    return null
  }
  const proofB64 = createHmac('sha256', plaintext.slice(secretStart))
    .update(text(`${HOST_PROOF_DOMAIN}\0ack\0`))
    .update(transcript)
    .digest('base64url')
  return {
    type: 'host-challenge-ack',
    v: 2,
    challengeId: args.challenge.challengeId,
    proofB64
  }
}
