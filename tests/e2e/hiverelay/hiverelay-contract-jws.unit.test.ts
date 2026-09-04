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
        purpose: 'cloud-relay-ed25519',
        alg: 'EdDSA',
        curve: 'Ed25519',
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
    keys: token.keys,
    verifierContext: {
      issuer: 'https://cloud.hive.test/relay',
      acceptedVerifierKids: ['unit-test-key'],
      privateOriginsByCellId: {}
    }
  })
}

describe('HiveRelay authority JWS lifetime rules', () => {
  it('accepts a positive lifetime up to the registry maximum and nbf equal to iat', () => {
    expect(validate({ iat: 970, nbf: 970, exp: 1_090 })).toBe('VALID_JWS')
    expect(validate({ iat: 970, nbf: 970, exp: 1_060 })).toBe('VALID_JWS')
  })

  it('rejects signed tokens with zero or excessive lifetime', () => {
    expect(validate({ iat: 1_000, nbf: 1_000, exp: 1_000 })).toBe('INVALID_TOKEN_LIFETIME')
    expect(validate({ iat: 970, nbf: 970, exp: 1_091 })).toBe('INVALID_TOKEN_LIFETIME')
  })

  it('rejects nbf drift and future iat beyond frozen clock skew', () => {
    expect(validate({ iat: 970, nbf: 971, exp: 1_090 })).toBe('INVALID_NBF')
    expect(validate({ iat: 1_031, nbf: 1_031, exp: 1_151 })).toBe('TOKEN_NOT_YET_VALID')
  })

  it('never adds clock skew to the signed expiry deadline', () => {
    expect(validate({ iat: 881, nbf: 881, exp: 1_001 })).toBe('VALID_JWS')
    expect(validate({ iat: 880, nbf: 880, exp: 1_000 })).toBe('TOKEN_EXPIRED')
    expect(validate({ iat: 879, nbf: 879, exp: 999 })).toBe('TOKEN_EXPIRED')
  })

  it('rejects NumericDate values outside the non-negative JSON safe-integer range', () => {
    expect(validate({ iat: -1, nbf: -1, exp: 119 })).toBe('INVALID_TOKEN_CLAIMS')
    expect(
      validate({
        iat: Number.MAX_SAFE_INTEGER + 1,
        nbf: Number.MAX_SAFE_INTEGER + 1,
        exp: Number.MAX_SAFE_INTEGER + 121
      })
    ).toBe('INVALID_TOKEN_CLAIMS')
  })
})
