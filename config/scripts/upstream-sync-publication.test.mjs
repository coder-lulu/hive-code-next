import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { renderPublication } from './upstream-sync-publication.mjs'

const temporaryDirectories = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const logs = path.resolve(import.meta.dirname, '../../logs/upstream-sync-tests')
  mkdirSync(logs, { recursive: true })
  const evidence = mkdtempSync(path.join(logs, 'publication-'))
  temporaryDirectories.push(evidence)
  const options = {
    evidence,
    upstream: 'a'.repeat(40),
    target: 'b'.repeat(40),
    candidate: 'c'.repeat(40),
    targetBranch: 'hivecode/main-next',
    runUrl: 'https://github.com/owner/repo/actions/runs/123'
  }
  const write = (name, report) =>
    writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(report))
  const intake = {
    schemaVersion: 1,
    passed: true,
    blockers: [],
    upstreamSha: options.upstream,
    headSha: options.candidate,
    stateRef: options.target,
    audit: { mode: 'full', baseSha: null },
    counts: { absorbed: 1, deferred: 0 },
    commits: [],
    pendingShas: []
  }
  write('upstream-intake-report', intake)
  write('fork-delta', { baseSha: options.upstream, headSha: options.candidate })
  write('product-delta', {
    baseSha: options.target,
    headSha: options.candidate,
    productBoundaryFiles: ['config/product/hivecode.product.json'],
    manualReviewFiles: ['src/main/git/runner.ts'],
    directAbsorbFiles: ['src/shared/pairing.ts'],
    changedFiles: [{ path: 'new-module.ts', oldPath: null }]
  })
  for (const suite of [
    'common-gates',
    'regression-linux',
    'regression-darwin',
    'regression-win32'
  ]) {
    write(suite, {
      suite,
      status: 'success',
      upstreamSha: options.upstream,
      targetSha: options.target,
      candidateSha: options.candidate,
      commands: ['focused verification']
    })
  }
  for (const name of [
    'fork-delta',
    'product-delta',
    'upstream-change-intake',
    'upstream-intake-report'
  ]) {
    writeFileSync(path.join(evidence, `${name}.md`), '# Full report\n')
  }
  return { options, write, intake }
}

describe('upstream sync publication evidence', () => {
  it('makes first-history review, every path ownership, and proposed checkpoint status explicit', () => {
    const { options } = fixture()
    const body = renderPublication(options)
    for (const sha of [options.upstream, options.target, options.candidate]) {
      expect(body).toContain(sha)
    }
    expect(body).toContain('Review the complete historical intake report')
    expect(body).toContain('checkpoint in this candidate is proposed only')
    expect(body).toContain('new-module.ts — unclassified; maintainer review required')
    expect(body).toContain('src/main/git/runner.ts — compatibility owner review')
    expect(body).toContain(options.runUrl)
  })

  it('carries pending feature decisions into an incremental review', () => {
    const { options, write, intake } = fixture()
    intake.audit = { mode: 'incremental', baseSha: 'e'.repeat(40) }
    intake.pendingShas = ['f'.repeat(40)]
    intake.commits = [
      {
        sha: intake.pendingShas[0],
        subject: 'Optional upstream UI',
        disposition: 'deferred',
        reason: 'Maintainer retains existing HiveCode navigation',
        review: {
          applied: '需要产品决定',
          reason: 'Maintainer retains existing HiveCode navigation',
          regressionTests: []
        },
        boundaryPaths: [{ path: 'resources/icon.png', classification: 'productBoundary' }]
      }
    ]
    write('upstream-intake-report', intake)
    const body = renderPublication(options)
    expect(body).toContain(
      `${intake.audit.baseSha}..${options.upstream}, plus unresolved carry-over`
    )
    expect(body).toContain('Maintainer retains existing HiveCode navigation')
    expect(body).toContain(`Pending SHAs: ${String(intake.pendingShas[0])}`)
  })

  it('refuses missing, failed, and stale evidence rather than asserting gates passed', () => {
    const { options, write, intake } = fixture()
    for (const change of [
      { passed: false },
      { blockers: ['missing fix'] },
      { stateRef: options.candidate },
      { headSha: options.target }
    ]) {
      write('upstream-intake-report', { ...intake, ...change })
      expect(() => renderPublication(options)).toThrow(/Intake/)
    }
    write('upstream-intake-report', intake)
    write('regression-darwin', {
      suite: 'regression-darwin',
      status: 'failure',
      candidateSha: options.candidate
    })
    expect(() => renderPublication(options)).toThrow(/gate evidence: regression-darwin/)
    rmSync(path.join(options.evidence, 'regression-darwin.json'))
    expect(() => renderPublication(options)).toThrow(/regression-darwin/)
  })

  it('rejects ancestry-only boundary absorption until explicit ledger review exists', () => {
    const { options, write, intake } = fixture()
    const commit = {
      sha: 'f'.repeat(40),
      disposition: 'absorbed',
      boundaryPaths: [{ path: 'src/main/git/runner.ts', classification: 'manualReview' }],
      review: null
    }
    intake.commits = [commit]
    write('upstream-intake-report', intake)
    expect(() => renderPublication(options)).toThrow('Missing explicit boundary review')
    commit.review = {
      applied: '已移植',
      reason: 'Preserved SSH host ownership',
      regressionTests: []
    }
    write('upstream-intake-report', intake)
    expect(() => renderPublication(options)).toThrow('regression evidence')
    commit.review.regressionTests = ['src/main/git/runner.test.ts']
    write('upstream-intake-report', intake)
    expect(() => renderPublication(options)).not.toThrow()
  })
})
