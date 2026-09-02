import nacl from 'tweetnacl'
import { describe, expect, it } from 'vitest'
import { validateFixtureJws } from './hiverelay-contract-jws'

function signedControlLease(times: { iat: number; nbf: number; exp: number }) {
  const keys = nacl.sign.keyPair()
  const header = {
    alg: 'EdDSA',
    typ: 'relay-control+jwt',
    kid: 'unit-test-key'
  }
  const claims = {
    iss: 'https://cloud.hive.test/relay',
    sub: 'runtime-01',
    aud: 'hive-relay-cell',
    scope: 'relay:control',
    jti: '11111111-1111-4111-8111-111111111111',
    ...times,
    cellId: 'cell-01',
    cellIncarnationId: '22222222-2222-4222-8222-222222222222',
    assignmentId: '33333333-3333-4333-8333-333333333333',
    relayHostId: 'AAAAAAAAAAAAAAAA',
    hostKeyHash: 'A'.repeat(43),
    runtimeTupleHash: 'A'.repeat(43),
    authorityGeneration: 7,
    fencingEpoch: 3,
    leaseEpoch: 11,
    assignmentEpoch: 5,
    controlGeneration: 2
  }
  const headerPart = Buffer.from(JSON.stringify(header)).toString('base64url')
  const claimsPart = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = nacl.sign.detached(Buffer.from(`${headerPart}.${claimsPart}`), keys.secretKey)
  return {
    compactJws: `${headerPart}.${claimsPart}.${Buffer.from(signature).toString('base64url')}`,
    keys: [
      {
        kid: header.kid,
        alg: 'EdDSA',
        publicKeyB64Url: Buffer.from(keys.publicKey).toString('base64url')
      }
    ]
  }
}

function validate(times: { iat: number; nbf: number; exp: number }): string {
  const token = signedControlLease(times)
  return validateFixtureJws({
    tokenType: 'controlLease',
    compactJws: token.compactJws,
    validationTime: 1_000,
    clockSkewSeconds: 30,
    lifetimeSeconds: 120,
    keys: token.keys
  })
}

describe('HiveRelay authority JWS lifetime rules', () => {
  it('accepts the exact registry lifetime and nbf equal to iat', () => {
    expect(validate({ iat: 970, nbf: 970, exp: 1_090 })).toBe('VALID_JWS')
  })

  it('rejects a signed token whose lifetime differs from the credential registry', () => {
    expect(validate({ iat: 970, nbf: 970, exp: 1_091 })).toBe('INVALID_TOKEN_LIFETIME')
  })

  it('rejects nbf drift and future iat beyond frozen clock skew', () => {
    expect(validate({ iat: 970, nbf: 971, exp: 1_090 })).toBe('INVALID_NBF')
    expect(validate({ iat: 1_031, nbf: 1_031, exp: 1_151 })).toBe('TOKEN_NOT_YET_VALID')
  })

  it('allows skew but rejects tokens expired beyond it', () => {
    expect(validate({ iat: 850, nbf: 850, exp: 970 })).toBe('VALID_JWS')
    expect(validate({ iat: 849, nbf: 849, exp: 969 })).toBe('TOKEN_EXPIRED')
  })
})
