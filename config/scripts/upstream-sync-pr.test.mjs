import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { renderPullRequest } from './upstream-sync-pr.mjs'

const temporaryDirectories = []
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const evidence = mkdtempSync(path.join(tmpdir(), 'upstream-sync-pr-'))
  temporaryDirectories.push(evidence)
  const options = {
    evidence,
    upstream: 'a'.repeat(40),
    target: 'b'.repeat(40),
    vendor: 'c'.repeat(40),
    vendorBase: 'd'.repeat(40),
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
    headSha: options.vendor,
    stateRef: options.target,
    audit: { mode: 'full', baseSha: null },
    counts: { absorbed: 1, deferred: 0 },
    commits: [],
    pendingShas: []
  }
  write('upstream-intake-report', intake)
  write('fork-delta', { baseSha: options.upstream, headSha: options.vendor })
  write('product-delta', {
    baseSha: options.target,
    headSha: options.vendor,
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
      vendorSha: options.vendor,
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

describe('upstream sync PR evidence', () => {
  it('makes first-history review, every path ownership, and proposed checkpoint status explicit', () => {
    const { options } = fixture()
    const body = renderPullRequest(options)
    for (const sha of [options.upstream, options.target, options.vendor, options.vendorBase]) {
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
        disposition: 'product-decision',
        reason: 'Maintainer retains existing HiveCode navigation',
        boundaryPaths: [{ path: 'resources/icon.png', classification: 'productBoundary' }]
      }
    ]
    write('upstream-intake-report', intake)
    const body = renderPullRequest(options)
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
      { stateRef: options.vendor },
      { headSha: options.target }
    ]) {
      write('upstream-intake-report', { ...intake, ...change })
      expect(() => renderPullRequest(options)).toThrow(/Intake/)
    }
    write('upstream-intake-report', intake)
    write('regression-darwin', {
      suite: 'regression-darwin',
      status: 'failure',
      vendorSha: options.vendor
    })
    expect(() => renderPullRequest(options)).toThrow(/gate evidence: regression-darwin/)
    rmSync(path.join(options.evidence, 'regression-darwin.json'))
    expect(() => renderPullRequest(options)).toThrow(/regression-darwin/)
  })
})

describe('upstream workflow evidence and publication contract', () => {
  it('publishes the checkpoint before testing, freezes all comparisons, and refreshes existing PR evidence', () => {
    const workflow = parse(
      readFileSync(new URL('../../.github/workflows/upstream-sync.yml', import.meta.url), 'utf8')
    )
    const sync = workflow.jobs.sync
    const runSteps = sync.steps.filter((step) => step.run)
    const intake = runSteps.findIndex((step) => step.run.includes('--write-checkpoint'))
    const publish = runSteps.findIndex((step) => step.run.includes('git push '))
    expect(intake).toBeGreaterThan(-1)
    expect(publish).toBeGreaterThan(intake)
    expect(runSteps[intake].run).toContain(
      '$RUNNER_TEMP/upstream-sync-control/config/scripts/upstream-intake.mjs'
    )
    expect(runSteps[intake].run).toContain('--state-ref "$TARGET_SHA"')
    expect(runSteps[publish].run).toContain(
      '--force-with-lease="refs/heads/$VENDOR_BRANCH:$VENDOR_BASE_SHA"'
    )
    expect(runSteps[publish].env.GH_TOKEN).toBe('${{ secrets.GITHUB_TOKEN }}')
    expect(runSteps[publish].run.indexOf('gh auth setup-git --hostname github.com')).toBeLessThan(
      runSteps[publish].run.indexOf('git ls-remote origin')
    )
    expect(runSteps[publish].run.indexOf('gh pr ready "$ready_pr" --undo')).toBeLessThan(
      runSteps[publish].run.indexOf('git push ')
    )
    expect(runSteps[publish].if).toBe("steps.checkpoint.outputs.has_changes == 'true'")
    expect(runSteps[intake].run).toContain('git diff --quiet "$TARGET_SHA" HEAD')
    expect(sync.outputs.vendor_sha).toBe('${{ steps.publish.outputs.vendor_sha }}')
    for (const job of ['gates', 'platform-gates']) {
      const checkout = workflow.jobs[job].steps.find((step) =>
        step.uses?.startsWith('actions/checkout@')
      )
      expect(checkout.with.ref).toBe('${{ needs.sync.outputs.vendor_sha }}')
      expect(workflow.jobs[job].if).toContain("needs.sync.outputs.has_changes == 'true'")
    }
    const gateSteps = workflow.jobs.gates.steps
    const executedCandidate = gateSteps.findIndex((step) => step.run?.includes('pnpm run test'))
    const finalEvidence = gateSteps.findIndex((step) => step.run?.includes('collectForkDelta'))
    expect(finalEvidence).toBeGreaterThan(executedCandidate)
    expect(gateSteps[finalEvidence].run).toContain('git archive "$TARGET_SHA" config')
    const proposal = workflow.jobs.propose.steps.find((step) => step.id === 'proposal').run
    expect(proposal.indexOf('git fetch --no-tags')).toBeLessThan(
      proposal.indexOf('git rev-parse "refs/remotes/origin/$VENDOR_BRANCH"')
    )
    expect(proposal).toContain('upstream-sync-pr.mjs')
    const final = workflow.jobs.propose.steps.at(-1).run
    expect(final).toContain('gh pr edit "$pr_number"')
    expect(final.indexOf('gh pr ready "$pr_number"')).toBeGreaterThan(
      final.indexOf('gh pr edit "$pr_number"')
    )
    expect(final).toContain('--body-file "$RUNNER_TEMP/upstream-sync-pr.md"')
    expect(workflow.jobs.propose.needs).toEqual(['sync', 'gates', 'platform-gates'])
  })
})
