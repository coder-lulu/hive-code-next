import { describe, expect, it } from 'vitest'
import {
  evaluateHiveRelayContractFixture,
  type HiveRelayContractContext,
  type HiveRelayContractFixture
} from './hiverelay-contract-validator'

const context: HiveRelayContractContext = {
  clockSkewSeconds: 30,
  frameLimits: {},
  testKeys: [],
  closeCodes: [],
  credentials: []
}

function evaluate(origin: string, allowedOrigins = [origin]) {
  const fixture: HiveRelayContractFixture = {
    schemaVersion: 1,
    contractRevision: 'hiverelay-v2-p0.1',
    caseId: 'unit.origin',
    suite: 'hiverelay-v2-conformance',
    operation: 'origin',
    applicableComponents: ['hivecode'],
    validationTime: 0,
    input: { origin, allowedOrigins, browser: true }
  }
  return evaluateHiveRelayContractFixture(fixture, context)
}

describe('HiveRelay canonical native origin validation', () => {
  it('accepts an exact lowercase ASCII HTTPS origin', () => {
    expect(evaluate('https://client.hive.test')).toMatchObject({
      verdict: 'ACCEPT',
      reason: 'VALID_ORIGIN'
    })
  })

  it.each([
    'https://client.hive.test/',
    'https://CLIENT.hive.test',
    'https://clïent.hive.test',
    'https://a-.hive.test',
    'https://a..hive.test',
    'https://client.hive.test:443',
    'https://client.hive.test:0',
    'https://client.hive.test:99999',
    'https://[::1]:8443',
    'https://client.hive.test/path',
    'https://user@client.hive.test',
    'https://client.hive.test?token=secret'
  ])('rejects non-canonical origin %s', (origin) => {
    expect(evaluate(origin)).toMatchObject({ verdict: 'REJECT', reason: 'INVALID_ORIGIN' })
  })

  it('requires an exact raw allowlist match', () => {
    expect(evaluate('https://client.hive.test', ['https://other.hive.test'])).toMatchObject({
      verdict: 'REJECT',
      reason: 'INVALID_ORIGIN'
    })
  })
})
