import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { recordingSourceInvocation, selectChecks } from './run-upstream-sync-gates.mjs'
import { validateRecordingSourceReports } from './upstream-sync-publication.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const sha = (c) => c.repeat(40)
const env = {
  TARGET_SHA: sha('a'),
  UPSTREAM_SHA: sha('b'),
  CANDIDATE_SHA: sha('c'),
  TARGET_BRANCH: 'hivecode/main-next'
}
const proof = {
  schemaVersion: 1,
  check: 'recording-source',
  passed: true,
  targetSha: env.TARGET_SHA,
  upstreamSha: env.UPSTREAM_SHA,
  candidateSha: env.CANDIDATE_SHA,
  controlSha: sha('d'),
  contentCommitSha: sha('e'),
  guardedSourcesSha256: 'f'.repeat(64),
  guardedFileCount: 11,
  controlSourcesSha256: 'e'.repeat(64),
  controlFileCount: 7
}
const check = {
  id: 'recording-source-common',
  kind: 'recording-source',
  argv: ['verify'],
  cwd: '.'
}
const names = ['common', 'linux', 'darwin', 'win32', 'publisher']
function reports() {
  const parent = path.join(root, 'logs/upstream-sync/recording-gate-tests')
  mkdirSync(parent, { recursive: true })
  const directory = mkdtempSync(path.join(parent, 'reports-'))
  for (const name of names) {
    writeFileSync(path.join(directory, `recording-source-${name}.json`), JSON.stringify(proof))
  }
  return directory
}

describe('frozen recording-source gate authority', () => {
  it('runs the control verifier beside the runner, never a candidate script', () => {
    const candidate = path.join(root, 'logs/upstream-sync/untrusted-candidate')
    const invocation = recordingSourceInvocation(check, candidate, env, 'linux')
    expect(invocation.command).toBe(process.execPath)
    expect(invocation.args[0]).toBe(path.join(import.meta.dirname, 'upstream-recording-source.mjs'))
    expect(invocation.args).toEqual([
      invocation.args[0],
      'verify',
      '--cwd',
      candidate,
      '--target',
      env.TARGET_SHA,
      '--upstream',
      env.UPSTREAM_SHA,
      '--head',
      env.CANDIDATE_SHA,
      '--target-branch',
      env.TARGET_BRANCH,
      '--report',
      path.join(candidate, 'logs/upstream-sync/evidence/recording-source-common.json')
    ])
    expect(invocation.args[0].startsWith(`${candidate}${path.sep}`)).toBe(false)
  })

  it.each([
    { TARGET_SHA: '' },
    { UPSTREAM_SHA: 'HEAD' },
    { CANDIDATE_SHA: `${sha('c')}\n` },
    { TARGET_BRANCH: 'feature/bypass' }
  ])('refuses missing or untrusted frozen inputs before execution: %j', (change) => {
    expect(() => recordingSourceInvocation(check, root, { ...env, ...change }, 'linux')).toThrow()
  })

  it('does not allow the manifest to select a control script or add arguments', () => {
    expect(() =>
      recordingSourceInvocation(
        { ...check, argv: ['verify', '--head', 'HEAD'] },
        root,
        env,
        'linux'
      )
    ).toThrow()
    expect(() =>
      recordingSourceInvocation({ ...check, cwd: 'mobile' }, root, env, 'linux')
    ).toThrow()
  })

  it.each(['linux', 'darwin', 'win32'])(
    'is mandatory in the common and actual %s platform selections',
    (platform) => {
      const manifest = JSON.parse(readFileSync(path.join(root, 'config/upstream-sync-gates.json')))
      const matrix = JSON.parse(
        readFileSync(path.join(root, 'config/upstream-regression-matrix.json'))
      )
      expect(
        selectChecks({ manifest, matrix, suite: 'common', platform }).filter(
          (x) => x.kind === 'recording-source'
        )
      ).toHaveLength(1)
      expect(
        selectChecks({ manifest, matrix, suite: 'regression', platform }).filter(
          (x) => x.kind === 'recording-source'
        )
      ).toHaveLength(1)
    }
  )
})

describe('publication requires all independently verified source proofs', () => {
  const options = {
    target: env.TARGET_SHA,
    upstream: env.UPSTREAM_SHA,
    candidate: env.CANDIDATE_SHA
  }
  it('accepts one exact proof from common, each OS and the isolated publisher', () => {
    expect(validateRecordingSourceReports({ ...options, evidence: reports() })).toEqual(proof)
  })
  it.each([
    { passed: false },
    { schemaVersion: 2 },
    { targetSha: sha('f') },
    { upstreamSha: sha('f') },
    { candidateSha: sha('f') },
    { controlSha: 'HEAD' },
    { contentCommitSha: env.TARGET_SHA },
    { guardedFileCount: 0 },
    { guardedFileCount: 1.5 },
    { guardedSourcesSha256: 'f'.repeat(63) },
    { controlFileCount: 0 },
    { controlFileCount: 1.5 },
    { controlSourcesSha256: 'e'.repeat(63) }
  ])('rejects a failed, stale or malformed proof: %j', (change) => {
    const evidence = reports()
    writeFileSync(
      path.join(evidence, 'recording-source-win32.json'),
      JSON.stringify({ ...proof, ...change })
    )
    expect(() => validateRecordingSourceReports({ ...options, evidence })).toThrow()
  })
  it('rejects internally well-formed proofs for different guarded sources', () => {
    const evidence = reports()
    writeFileSync(
      path.join(evidence, 'recording-source-publisher.json'),
      JSON.stringify({ ...proof, guardedSourcesSha256: 'e'.repeat(64) })
    )
    expect(() => validateRecordingSourceReports({ ...options, evidence })).toThrow(/source proof/i)
  })
  it('cannot omit publisher verification even when all OS jobs have proofs', () => {
    const evidence = reports()
    const missing = path.join(evidence, 'recording-source-publisher.json')
    writeFileSync(missing, '{}')
    expect(() => validateRecordingSourceReports({ ...options, evidence })).toThrow()
  })

  it('rejects a platform that used different executable recording controls', () => {
    const evidence = reports()
    writeFileSync(
      path.join(evidence, 'recording-source-linux.json'),
      JSON.stringify({ ...proof, controlSourcesSha256: 'a'.repeat(64) })
    )
    expect(() => validateRecordingSourceReports({ ...options, evidence })).toThrow(/source proof/i)
  })
  it('wires the publisher to frozen source verification before rendering a decision', () => {
    const workflow = parse(
      readFileSync(path.join(root, '.github/workflows/upstream-sync.yml'), 'utf8')
    )
    const run = workflow.jobs.publish.steps.find(
      (x) => x.name === 'Validate evidence and candidate without executing incoming code'
    ).run
    expect(run.indexOf('node config/scripts/upstream-recording-source.mjs verify')).toBeGreaterThan(
      0
    )
    expect(run.indexOf('node config/scripts/upstream-recording-source.mjs verify')).toBeLessThan(
      run.indexOf('node config/scripts/upstream-sync-publication.mjs')
    )
    expect(workflow.jobs.gates.permissions.contents).toBe('read')
    expect(workflow.jobs['platform-gates'].permissions.contents).toBe('read')
  })
})
