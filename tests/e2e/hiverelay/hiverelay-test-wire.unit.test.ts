import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { answerHostChallenge, issueHostChallenge } from './hiverelay-host-proof'
import {
  ClientAdmissionSchema,
  HostChallengeSchema,
  HostHelloSchema,
  deriveHiveRelayHostId,
  parseStrictJson,
  toBase64Url,
  type HiveRelayBinding,
  type HostHello
} from './hiverelay-test-wire'

function bindingFor(publicKey: Uint8Array): HiveRelayBinding {
  return {
    cellId: 'cell-a',
    cellIncarnationId: '00000000-0000-4000-8000-000000000001',
    runtimeId: 'runtime-1',
    runtimeBootId: '00000000-0000-4000-8000-000000000002',
    authorityGeneration: 1,
    fencingEpoch: 2,
    leaseEpoch: 3,
    assignmentId: '00000000-0000-4000-8000-000000000003',
    assignmentEpoch: 4,
    controlGeneration: 5,
    relayHostId: deriveHiveRelayHostId(publicKey)
  }
}

describe('HiveRelay P0 test wire primitives', () => {
  it('rejects duplicate and unknown JSON fields before a peer sees them', () => {
    const valid = {
      type: 'relay-auth',
      v: 2,
      clientAdmissionToken: `e30.e30.${'A'.repeat(86)}`,
      clientPublicKeyB64: toBase64Url(new Uint8Array(32).fill(1))
    }

    expect(() =>
      parseStrictJson(
        `{"type":"relay-auth","type":"relay-auth","v":2,"clientAdmissionToken":"${valid.clientAdmissionToken}","clientPublicKeyB64":"${valid.clientPublicKeyB64}"}`,
        ClientAdmissionSchema
      )
    ).toThrow('Duplicate JSON key')
    expect(() =>
      parseStrictJson(
        JSON.stringify({ ...valid, ticketSecret: 'must-not-cross-cell' }),
        ClientAdmissionSchema
      )
    ).toThrow('unrecognized_keys')
  })

  it('uses a new domain and the full Cell/Runtime/Assignment tuple for Host proof', () => {
    const keys = nacl.box.keyPair()
    const binding = bindingFor(keys.publicKey)
    const hello: HostHello = {
      type: 'host-hello',
      v: 2,
      ...binding,
      hostPublicKeyB64: toBase64Url(keys.publicKey),
      capabilities: ['ticket-connect-v2']
    }
    const challenge = issueHostChallenge({
      hello,
      cellOrigin: 'https://cell-a.hiverelay.test',
      now: 1_000_000
    })

    expect(
      answerHostChallenge({
        challenge: challenge.message,
        binding,
        cellOrigin: 'https://cell-a.hiverelay.test',
        hostPublicKey: keys.publicKey,
        hostSecretKey: keys.secretKey,
        now: 1_000_001
      })
    ).toEqual({
      type: 'host-challenge-ack',
      v: 2,
      challengeId: challenge.message.challengeId,
      proofB64: challenge.expectedProofB64
    })
    expect(
      answerHostChallenge({
        challenge: challenge.message,
        binding: { ...binding, controlGeneration: binding.controlGeneration + 1 },
        cellOrigin: 'https://cell-a.hiverelay.test',
        hostPublicKey: keys.publicKey,
        hostSecretKey: keys.secretKey,
        now: 1_000_001
      })
    ).toBeNull()
  })

  it('enforces authority canonical ciphertext and unique capabilities', () => {
    const keys = nacl.box.keyPair()
    const binding = bindingFor(keys.publicKey)
    expect(
      HostHelloSchema.safeParse({
        type: 'host-hello',
        v: 2,
        ...binding,
        hostPublicKeyB64: toBase64Url(keys.publicKey),
        capabilities: ['ticket-connect-v2', 'ticket-connect-v2']
      }).success
    ).toBe(false)
    expect(
      HostChallengeSchema.safeParse({
        type: 'host-challenge',
        v: 2,
        challengeId: 'challenge-1',
        relayEphemeralPublicKeyB64: toBase64Url(keys.publicKey),
        nonceB64: toBase64Url(new Uint8Array(24)),
        ciphertextB64: 'not+base64url',
        expiresAt: 1
      }).success
    ).toBe(false)
  })
})
