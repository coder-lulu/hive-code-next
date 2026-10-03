import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectIntakeReport } from './upstream-intake.mjs'
import { collectUpstreamChanges } from './track-upstream-changes.mjs'
import {
  createGit,
  requireBoundaryReview,
  resolveAuditRange,
  STATE_PATH,
  writeCheckpoint
} from './upstream-sync-checkpoint.mjs'

const repos = []
const script = path.join(import.meta.dirname, 'upstream-intake.mjs')

function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'upstream-intake-'))
  repos.push(cwd)
  const git = (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  git(['init', '-b', 'hivecode/main-next'])
  git(['config', 'user.email', 'intake@example.test'])
  git(['config', 'user.name', 'Intake Test'])
  git(['config', 'commit.gpgSign', 'false'])
  const write = (name, contents) => {
    mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true })
    writeFileSync(path.join(cwd, name), contents)
  }
  const commit = (subject) => {
    git(['add', '.'])
    git(['commit', '--allow-empty', '-m', subject])
    return git(['rev-parse', 'HEAD'])
  }
  const ledger = (entries) =>
    write('config/upstream-change-ledger.json', JSON.stringify({ schemaVersion: 1, entries }))
  ledger([])
  write('base.txt', 'seed\n')
  const base = commit('Start product')
  git(['branch', 'upstream'])
  const audit = (stateRef = base) => collectIntakeReport({ cwd, upstream: 'upstream', stateRef })
  return { cwd, git, write, commit, ledger, base, audit }
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

describe('upstream inclusion and product-owned audit cursor', { timeout: 60000 }, () => {
  it('writes the default diagnostic report under logs without recreating private docs', () => {
    const f = fixture()
    const result = spawnSync(
      process.execPath,
      [script, '--cwd', f.cwd, '--upstream', 'upstream', '--state-ref', f.base],
      { cwd: f.cwd, encoding: 'utf8', windowsHide: true }
    )
    expect(result.status).toBe(0)
    expect(
      readFileSync(path.join(f.cwd, 'logs/upstream-sync/upstream-intake-report.md'), 'utf8')
    ).toContain('# Upstream intake report')
    expect(existsSync(path.join(f.cwd, 'docs'))).toBe(false)
  })
  it('fails automatic checkpoint publication when clean ancestry lacks boundary review', () => {
    const f = fixture()
    const reportPath = path.join(f.cwd, 'logs', 'intake.json')
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--cwd',
        f.cwd,
        '--upstream',
        'upstream',
        '--head',
        'HEAD',
        '--state-ref',
        f.base,
        '--require-boundary-review',
        '--write-checkpoint',
        '--report',
        path.join(f.cwd, 'logs', 'intake.md'),
        '--json-output',
        reportPath
      ],
      { cwd: f.cwd, encoding: 'utf8', windowsHide: true }
    )
    expect(result.status).toBe(1)
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    expect(report.passed).toBe(false)
    expect(report.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'boundary-review' })])
    )
    expect(() => readFileSync(path.join(f.cwd, STATE_PATH))).toThrow()
  })

  it('writes proposals only on the audited allowed target and rejects stale or blocked reports', async () => {
    const f = fixture()
    const report = await f.audit()
    expect(() => writeCheckpoint(report, f.cwd)).not.toThrow()
    const before = readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')
    for (const change of [
      { targetBranch: 'main' },
      { targetBranch: 'feature/sync' },
      { headSha: 'a'.repeat(40) },
      { blockers: ['unabsorbed fix'] }
    ]) {
      expect(() => writeCheckpoint({ ...report, ...change }, f.cwd)).toThrow()
      expect(readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')).toBe(before)
    }
    f.git(['checkout', '--detach'])
    expect(() => writeCheckpoint(report, f.cwd)).toThrow('exact allowed product target')
    f.git(['checkout', '-b', 'main'])
    expect(() => writeCheckpoint({ ...report, targetBranch: 'main' }, f.cwd)).not.toThrow()
  })

  it('audits all history once, ignores the candidate cursor, then retries the same incremental range until product promotion', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('feature.txt', 'feature\n')
    const feature = f.commit('Add non-overlapping feature')
    f.git(['checkout', 'hivecode/main-next'])
    f.git(['merge', '--no-ff', '--no-edit', 'upstream'])
    const first = await f.audit()
    expect(first).toMatchObject({ passed: true, audit: { mode: 'full', baseSha: null } })
    expect(first.commits.map((row) => row.sha)).toEqual(expect.arrayContaining([f.base, feature]))
    expect(first.commits.every((row) => row.evidence.scope === 'history inclusion only')).toBe(true)
    writeCheckpoint(first, f.cwd)
    const product = f.commit('Approve complete initial audit')
    const approvedState = readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')
    writeCheckpoint(await f.audit(product), f.cwd)
    expect(readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')).toBe(approvedState)
    expect((await f.audit()).audit.mode).toBe('full')
    f.git(['checkout', 'upstream'])
    f.write('next.txt', 'next\n')
    const next = f.commit('Add second feature')
    f.git(['checkout', 'hivecode/main-next'])
    const failed = await f.audit(product)
    expect(failed).toMatchObject({
      passed: false,
      audit: { mode: 'incremental', baseSha: feature }
    })
    expect(failed.commits.map((row) => row.sha)).toEqual([next])
    const before = readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')
    expect(() => writeCheckpoint(failed, f.cwd)).toThrow('failed')
    expect(readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')).toBe(before)
    f.git(['merge', '--no-ff', '--no-edit', 'upstream'])
    const retry = await f.audit(product)
    expect(retry.passed).toBe(true)
    expect(retry.commits.map((row) => row.sha)).toEqual([next])
    const priority = collectUpstreamChanges({
      git: createGit(f.cwd),
      head: 'upstream',
      stateRef: product
    })
    expect(priority.changes.map((row) => row.sha)).toEqual([next])
    f.git(['branch', '-f', 'upstream', f.base])
    await expect(f.audit(product)).rejects.toThrow('rewritten')
  })

  it('requires non-empty stable patch identity, even when subjects match, and accepts differently named cherry-picks', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('fix.txt', 'fixed\n')
    const fix = f.commit('Fix upstream behavior')
    f.git(['checkout', 'hivecode/main-next'])
    f.git(['cherry-pick', '-x', fix])
    f.git(['commit', '--amend', '-m', 'Preserve behavior in HiveCode'])
    const equivalent = await f.audit()
    expect(equivalent.passed).toBe(true)
    expect(equivalent.commits.find((row) => row.sha === fix)).toMatchObject({
      disposition: 'equivalent',
      evidence: { kind: 'stable-patch-id' }
    })
    f.git(['checkout', 'upstream'])
    const empty = f.commit('Fix empty migration')
    f.git(['checkout', 'hivecode/main-next'])
    f.commit('Fix empty migration')
    const report = await f.audit()
    expect(report.passed).toBe(false)
    expect(report.commits.find((row) => row.sha === empty)).toMatchObject({
      disposition: 'unresolved',
      evidence: null
    })
  })

  it('blocks dependencies missing behind an equivalent child and rejects unsupported ledger equivalence', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('dependency.txt', 'needed\n')
    const dependency = f.commit('Add dependency')
    f.write('fix.txt', 'fixed\n')
    const fix = f.commit('Fix dependent behavior')
    f.git(['checkout', 'hivecode/main-next'])
    f.git(['cherry-pick', '-x', fix])
    f.ledger([
      {
        upstreamSha: dependency,
        type: '新功能',
        applied: '已等价实现',
        dependencies: [],
        adaptation: 'Claim only',
        regressionTests: ['dependency']
      }
    ])
    f.commit('Record unsupported claim')
    const report = await f.audit()
    expect(report.passed).toBe(false)
    expect(report.commits.find((row) => row.sha === dependency).disposition).toBe('unresolved')
    expect(report.blockers).toContainEqual(
      expect.objectContaining({ sha: fix, code: 'dependency-closure', dependencies: [dependency] })
    )
  })

  it('carries explicit boundary feature decisions forward and never treats a deferred fix as an allowed product decision', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('config/product/feature.json', '{}\n')
    const feature = f.commit('Add product feature')
    f.git(['checkout', 'hivecode/main-next'])
    const entry = {
      upstreamSha: feature,
      type: '新功能',
      applied: '暂缓',
      dependencies: [],
      conflictReason: 'Requires a product account decision',
      regressionTests: []
    }
    f.ledger([entry])
    f.commit('Record explicit feature decision')
    const first = await f.audit()
    expect(first).toMatchObject({ passed: true, pendingShas: [feature] })
    writeCheckpoint(first, f.cwd)
    const product = f.commit('Approve audit with tracked product decision')
    const second = await f.audit(product)
    expect(second).toMatchObject({
      passed: true,
      audit: { mode: 'incremental' },
      pendingShas: [feature]
    })
    expect(second.commits.map((row) => row.sha)).toEqual([feature])
    f.git(['checkout', 'upstream'])
    f.write('unrelated-fix.txt', 'fixed\n')
    const unrelated = f.commit('Fix unrelated behavior')
    f.git(['checkout', 'hivecode/main-next'])
    f.git(['merge', '--no-ff', '--no-edit', 'upstream'])
    const withFix = await f.audit(product)
    expect(withFix).toMatchObject({ passed: true, pendingShas: [feature] })
    expect(withFix.commits.find((row) => row.sha === unrelated).unresolvedDependencies).toEqual([])
    f.ledger([{ ...entry, type: 'BUG' }])
    f.commit('Reclassify as required correction')
    expect((await f.audit(product)).passed).toBe(false)
  })

  it('closes a carried product decision only through an explicit reviewed exclusion', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('config/product/download-link.json', '{}\n')
    const feature = f.commit('Publish an upstream-only download link')
    f.git(['checkout', 'hivecode/main-next'])
    const pending = {
      upstreamSha: feature,
      type: '新功能',
      applied: '需要产品决定',
      dependencies: [],
      boundaryConflict: 'maintained-capability',
      conflictReason: 'The public download destination is product-owned',
      regressionTests: ['product download configuration remains empty']
    }
    f.ledger([pending])
    f.commit('Track the product decision')
    const first = await f.audit()
    expect(first).toMatchObject({ passed: true, pendingShas: [feature] })
    writeCheckpoint(first, f.cwd)
    const product = f.commit('Publish the pending review checkpoint')

    f.ledger([
      {
        ...pending,
        applied: '不吸收',
        reviewReason: 'HiveCode does not publish Orca download destinations'
      }
    ])
    f.commit('Record the product exclusion')
    const resolved = await f.audit(product)
    expect(resolved).toMatchObject({
      passed: true,
      pendingShas: [],
      counts: { excluded: 1 }
    })
    expect(resolved.commits.find((row) => row.sha === feature)).toMatchObject({
      disposition: 'excluded',
      evidence: {
        kind: 'product-exclusion',
        boundaryConflict: 'maintained-capability'
      }
    })
    expect(() => requireBoundaryReview(resolved)).not.toThrow()

    f.ledger([{ ...pending, type: 'BUG', applied: '不吸收' }])
    f.commit('Attempt to exclude a required correction')
    expect((await f.audit(product)).passed).toBe(false)
  })

  it('requires a reachable product commit and regression evidence for semantic adaptations', async () => {
    const f = fixture()
    f.git(['checkout', 'upstream'])
    f.write('fix.txt', 'upstream fix\n')
    const fix = f.commit('Fix security behavior')
    f.git(['checkout', 'hivecode/main-next'])
    f.write('alternative.txt', 'adapted fix\n')
    const productSha = f.commit('Preserve the capability with product architecture')
    const entry = {
      upstreamSha: fix,
      type: '安全',
      applied: '已等价实现',
      dependencies: [],
      productSha,
      reviewReason: 'Equivalent denial through the HiveCode capability gate',
      regressionTests: ['capability denial']
    }
    f.ledger([entry])
    f.commit('Record reviewed adaptation')
    const report = await f.audit()
    expect(report.passed).toBe(true)
    expect(report.commits.find((row) => row.sha === fix).evidence.kind).toBe('reviewed-adaptation')
    f.ledger([{ ...entry, productSha: fix }])
    f.commit('Record unreachable adaptation')
    expect((await f.audit()).passed).toBe(false)
  })

  it('rejects malformed, foreign and missing-pending checkpoints and writes failure evidence without advancing state', async () => {
    const f = fixture()
    const state = {
      schemaVersion: 1,
      upstream: 'stablyai/orca',
      targetBranch: 'hivecode/main-next',
      initialAuditCompleted: true,
      lastReviewedUpstreamSha: f.base,
      pendingShas: []
    }
    for (const invalid of [
      { ...state, schemaVersion: 99 },
      { ...state, targetBranch: 'main' },
      { ...state, pendingShas: ['f'.repeat(40)] }
    ]) {
      f.write(STATE_PATH, JSON.stringify(invalid))
      const product = f.commit('Persist invalid cursor for rejection')
      expect(() =>
        resolveAuditRange({ git: createGit(f.cwd), upstream: 'upstream', stateRef: product })
      ).toThrow()
    }
    const before = readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--upstream',
        'upstream',
        '--head',
        'HEAD',
        '--state-ref',
        'HEAD',
        '--report',
        path.join(f.cwd, 'report.md'),
        '--json-output',
        path.join(f.cwd, 'report.json'),
        '--write-checkpoint'
      ],
      { cwd: f.cwd, encoding: 'utf8', windowsHide: true }
    )
    expect(result.status).toBe(1)
    expect(JSON.parse(readFileSync(path.join(f.cwd, 'report.json'), 'utf8'))).toMatchObject({
      passed: false,
      blockers: [{ code: 'preflight' }]
    })
    expect(readFileSync(path.join(f.cwd, STATE_PATH), 'utf8')).toBe(before)
  })
})
