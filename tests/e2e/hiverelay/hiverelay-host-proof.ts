import { createHmac, randomBytes } from 'node:crypto'
import nacl from 'tweetnacl'
import {
  fromBase64Url,
  toBase64Url,
  type HostChallenge,
  type HostHello
} from './hiverelay-test-wire'
import { encodeHostProofTranscript } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-proof-v2'
export {
  answerHostChallenge,
  encodeHostProofTranscript
} from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-host-proof-v2'
const HOST_PROOF_DOMAIN = 'hive-relay-host-proof/v2'
const HOST_CHALLENGE_DOMAIN = 'hive-relay-host-challenge/v2'
const MAX_CHALLENGE_WINDOW_MS = 10_000
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

function text(value: string): Uint8Array {
  return encoder.encode(value)
}

export type IssuedHostChallenge = {
  message: HostChallenge
  expectedProofB64: string
}

export function issueHostChallenge(args: {
  hello: HostHello
  cellOrigin: string
  now: number
  random?: (size: number) => Uint8Array
}): IssuedHostChallenge {
  const hostPublicKey = fromBase64Url(args.hello.hostPublicKeyB64, 32)
  if (!hostPublicKey) {
    throw new Error('Host public key is not canonical base64url')
  }
  const makeRandom = args.random ?? ((size: number) => randomBytes(size))
  const relayKeys = nacl.box.keyPair.fromSecretKey(makeRandom(32))
  const challengeNonce = makeRandom(24)
  const secret = makeRandom(32)
  const challengeId = `challenge-${toBase64Url(makeRandom(16))}`
  const expiresAt = args.now + MAX_CHALLENGE_WINDOW_MS
  const transcript = encodeHostProofTranscript({
    cellOrigin: args.cellOrigin,
    binding: args.hello,
    hostPublicKey,
    relayEphemeralPublicKey: relayKeys.publicKey,
    challengeNonce,
    challengeId,
    issuedAt: args.now,
    expiresAt
  })
  const plaintext = concat([
    text(`${HOST_CHALLENGE_DOMAIN}\0`),
    uint32(transcript.byteLength),
    transcript,
    secret
  ])
  const ciphertext = nacl.box(plaintext, challengeNonce, hostPublicKey, relayKeys.secretKey)
  const expectedProofB64 = createHmac('sha256', secret)
    .update(text(`${HOST_PROOF_DOMAIN}\0ack\0`))
    .update(transcript)
    .digest('base64url')
  return {
    message: {
      type: 'host-challenge',
      v: 2,
      challengeId,
      relayEphemeralPublicKeyB64: toBase64Url(relayKeys.publicKey),
      nonceB64: toBase64Url(challengeNonce),
      ciphertextB64: toBase64Url(ciphertext),
      expiresAt
    },
    expectedProofB64
  }
}
