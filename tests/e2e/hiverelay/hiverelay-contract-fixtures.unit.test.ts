import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  evaluateHiveRelayContractFixture,
  parseHiveRelayContractFixture,
  type HiveRelayContractContext,
  type HiveRelayContractResult
} from './hiverelay-contract-validator'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CONTRACT_ROOT = process.env.HIVERELAY_CONTRACT_ROOT
  ? path.resolve(process.env.HIVERELAY_CONTRACT_ROOT)
  : path.join(REPO_ROOT, 'config', 'hiverelay-contract')
const REPORT_PATH = process.env.HIVERELAY_CONTRACT_REPORT_PATH

type ManifestFixture = {
  path: string
  kind: 'fixture'
  applicableComponents: string[]
  sha256: string
  caseId: string
  expectedVerdict: 'ACCEPT' | 'REJECT'
  expectedReason: string
}
type Manifest = {
  schemaVersion: 1
  contractRevision: string
  files: (ManifestFixture | { kind: string; path: string })[]
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(CONTRACT_ROOT, relativePath), 'utf8')) as T
}

const manifest = readJson<Manifest>('fixture-manifest.json')
const fixtureEntries = manifest.files.filter(
  (entry): entry is ManifestFixture => entry.kind === 'fixture'
)
const applicableFixtureCount = fixtureEntries.filter((entry) =>
  entry.applicableComponents.includes('hivecode')
).length
const limits = readJson<{
  time: { clockSkewSeconds: number }
  frames: Record<string, number | boolean>
}>('registries/limits.json')
const testKeys = readJson<{
  keys: { kid: string; purpose: string; alg: string; curve: string; publicKeyB64Url: string }[]
}>('registries/test-keys.json')
const closeCodes = readJson<{ codes: { symbol: string; code: number }[] }>(
  'registries/close-codes.json'
)
const credentials = readJson<{
  credentials: { name: string; lifetimeSeconds: number }[]
}>('registries/credentials.json')
const context: HiveRelayContractContext = {
  clockSkewSeconds: limits.time.clockSkewSeconds,
  frameLimits: limits.frames,
  testKeys: testKeys.keys,
  closeCodes: closeCodes.codes,
  credentials: credentials.credentials
}
const observedResults: HiveRelayContractResult[] = []
const errors: string[] = []

afterAll(async () => {
  if (!REPORT_PATH) {
    return
  }
  const receipt = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'config', 'hiverelay-contract-source.json'), 'utf8')
  ) as { manifestSha256: string }
  const status = errors.length === 0 && observedResults.length === fixtureEntries.length
  const report = {
    schemaVersion: 1,
    component: 'hivecode-typescript',
    status: status ? 'PASS' : 'FAIL',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
    contractRevision: manifest.contractRevision,
    manifestSha256: receipt.manifestSha256,
    testCount: applicableFixtureCount,
    resultCount: observedResults.length,
    applicableFixtureCount,
    results: observedResults,
    errors
  }
  await mkdir(path.dirname(REPORT_PATH), { recursive: true })
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
})

describe('HiveRelay vendored contract fixtures', () => {
  if (process.env.HIVERELAY_CLOUD_ISSUER_FIXTURE_PATH) {
    it('accepts credentials produced by the current Cloud issuer', () => {
      const fixture = parseHiveRelayContractFixture(
        readFileSync(process.env.HIVERELAY_CLOUD_ISSUER_FIXTURE_PATH!, 'utf8')
      )
      expect(fixture.contractRevision).toBe(manifest.contractRevision)
      expect(fixture.caseId).toBe('v2.jws.cloud-issuer.short-ttl')
      expect(evaluateHiveRelayContractFixture(fixture, context)).toMatchObject({
        verdict: 'ACCEPT',
        reason: 'VALID_JWS'
      })
    })
  }

  it('contains at least one HiveCode-applicable fixture', () => {
    expect(fixtureEntries.some((entry) => entry.applicableComponents.includes('hivecode'))).toBe(
      true
    )
  })

  for (const entry of fixtureEntries) {
    it(entry.caseId, () => {
      try {
        const fixture = parseHiveRelayContractFixture(
          readFileSync(path.join(CONTRACT_ROOT, entry.path), 'utf8')
        )
        expect(fixture.caseId).toBe(entry.caseId)
        expect(fixture.contractRevision).toBe(manifest.contractRevision)
        expect(fixture.applicableComponents).toEqual(entry.applicableComponents)
        const actual = evaluateHiveRelayContractFixture(fixture, context)
        observedResults.push(actual)
        expect(actual).toEqual(
          entry.applicableComponents.includes('hivecode')
            ? {
                caseId: entry.caseId,
                verdict: entry.expectedVerdict,
                reason: entry.expectedReason
              }
            : {
                caseId: entry.caseId,
                verdict: 'NOT_APPLICABLE',
                reason: 'COMPONENT_NOT_APPLICABLE'
              }
        )
      } catch (error) {
        errors.push(`${entry.caseId}: ${error instanceof Error ? error.message : String(error)}`)
        throw error
      }
    })
  }

  it('reports legacy v1 fixtures as not applicable to a v2-only Cell', () => {
    for (const entry of fixtureEntries.filter((candidate) =>
      candidate.path.startsWith('fixtures/legacy-v1/')
    )) {
      const fixture = parseHiveRelayContractFixture(
        readFileSync(path.join(CONTRACT_ROOT, entry.path), 'utf8')
      )
      expect(evaluateHiveRelayContractFixture(fixture, context, 'cell')).toEqual({
        caseId: entry.caseId,
        verdict: 'NOT_APPLICABLE',
        reason: 'COMPONENT_NOT_APPLICABLE'
      })
    }
  })

  it('rejects a Runtime tuple duplicated inconsistently inside the protected payload', () => {
    const fixture = parseHiveRelayContractFixture(
      readFileSync(path.join(CONTRACT_ROOT, 'fixtures/v2/runtime-proof-valid.json'), 'utf8')
    )
    const payload = fixture.input.protectedPayload as Record<string, unknown>
    payload.runtimeId = 'different-runtime'
    expect(evaluateHiveRelayContractFixture(fixture, context)).toMatchObject({
      verdict: 'REJECT',
      reason: 'WRONG_BINDING'
    })
  })

  it('binds every Runtime tuple field into the frozen length-prefixed digest', () => {
    const fixture = parseHiveRelayContractFixture(
      readFileSync(path.join(CONTRACT_ROOT, 'fixtures/v2/runtime-tuple-hash-valid.json'), 'utf8')
    )
    const mutations = {
      runtimeId: 'runtime-02',
      runtimeBootId: '33333333-3333-4333-8333-333333333333',
      authorityGeneration: 8,
      fencingEpoch: 4,
      leaseEpoch: 12
    }
    for (const [field, value] of Object.entries(mutations)) {
      const changed = structuredClone(fixture)
      changed.input[field] = value
      expect(evaluateHiveRelayContractFixture(changed, context), field).toMatchObject({
        verdict: 'REJECT',
        reason: 'WRONG_BINDING'
      })
    }
  })
})
