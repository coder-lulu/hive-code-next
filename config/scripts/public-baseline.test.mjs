import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGit } from './upstream-sync-checkpoint.mjs'
import { collectImportedAdaptations } from './public-baseline.mjs'
import { collectIntakeReport } from './upstream-intake.mjs'
import { prepareUpstreamTreeSync } from './upstream-tree-sync.mjs'

function fixture(applied = '已移植') {
  const directory = path.resolve('logs/open-source-baseline/tests')
  mkdirSync(directory, { recursive: true })
  const cwd = mkdtempSync(path.join(directory, 'baseline-'))
  const git = createGit(cwd)
  git(['init', '-b', 'hivecode/main-next'])
  git(['config', 'user.name', 'Baseline Test'])
  git(['config', 'user.email', 'baseline@example.test'])
  git(['config', 'commit.gpgSign', 'false'])
  const write = (file, value) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    writeFileSync(path.join(cwd, file), JSON.stringify(value))
  }
  const commit = () => {
    git(['add', '.'])
    git(['commit', '--allow-empty', '-m', 'Baseline fixture'])
    return git(['rev-parse', 'HEAD']).trim()
  }
  write('upstream.json', {})
  if (applied === '暂缓') {
    write('config/product/pending-feature.json', {})
  }
  const upstream = commit()
  const productSha = commit()
  const reviewedUpstreamSha = applied === '暂缓' ? productSha : upstream
  const entry = {
    upstreamSha: upstream,
    productSha,
    applied,
    ...(applied === '暂缓' ? { type: '新功能', boundaryConflict: 'maintained-capability' } : {}),
    dependencies: [],
    reviewReason:
      applied === '暂缓'
        ? 'Awaiting a product decision for an optional provider extension'
        : 'Verified original adaptation',
    regressionTests: ['original-regression']
  }
  write('config/upstream-change-ledger.json', { schemaVersion: 1, entries: [entry] })
  write('config/upstream-sync-state.json', {
    schemaVersion: 1,
    upstream: 'stablyai/orca',
    targetBranch: 'hivecode/main-next',
    initialAuditCompleted: true,
    lastReviewedUpstreamSha: reviewedUpstreamSha,
    pendingShas: [upstream]
  })
  const sourceCommit = commit()
  const receipt = {
    schemaVersion: 1,
    kind: 'public-tree-baseline',
    archiveRepository: 'https://github.com/coder-lulu/hive-code-next-history',
    sourceCommit,
    sourceTree: git(['rev-parse', `${sourceCommit}^{tree}`]).trim(),
    ledgerBlob: git(['rev-parse', `${sourceCommit}:config/upstream-change-ledger.json`]).trim(),
    reviewedUpstreamSha,
    pendingShas: [upstream],
    preservedProductCommits: [productSha]
  }
  write('config/open-source-baseline.json', receipt)
  writeFileSync(
    path.join(cwd, '.gitmodules'),
    '[submodule "docs"]\n\tpath = docs\n\turl = https://example.test/private-docs.git\n'
  )
  mkdirSync(path.join(cwd, 'docs'), { recursive: true })
  git(['add', '.'])
  git(['update-index', '--add', '--cacheinfo', '160000', sourceCommit, 'docs'])
  const tree = git(['write-tree']).trim()
  const root = git(['commit-tree', tree, '-m', 'Initial public fixture']).trim()
  git(['update-ref', 'refs/heads/hivecode/main-next', root])
  return { cwd, git, entry, root, receipt, write, commit }
}

function mergePublicRoot(f, alter = () => {}) {
  alter(f)
  f.git(['add', '.'])
  const other = f
    .git(['commit-tree', f.git(['write-tree']).trim(), '-m', 'Independent public fixture'])
    .trim()
  f.git(['checkout', f.root, '--', 'config'])
  const head = f
    .git([
      'commit-tree',
      f.git(['rev-parse', `${f.root}^{tree}`]).trim(),
      '-p',
      f.root,
      '-p',
      other,
      '-m',
      'Merge independently published product work'
    ])
    .trim()
  f.git(['update-ref', 'refs/heads/hivecode/main-next', head])
  return head
}

describe('immutable public root provenance', () => {
  it('retains archived evidence after joining roots with identical reviewed provenance', () => {
    const f = fixture()
    const head = mergePublicRoot(f)
    expect(f.git(['rev-list', '--max-parents=0', head]).trim().split(/\s+/)).toHaveLength(2)
    expect(collectImportedAdaptations({ git: f.git, head }).get(f.entry.upstreamSha)).toEqual(
      f.entry
    )
  }, 60000)

  it.each([
    'receipt-missing',
    'receipt-changed',
    'ledger-changed',
    'cursor-changed',
    'pending-changed'
  ])('refuses a second root with %s', (change) => {
    const f = fixture()
    const head = mergePublicRoot(f, (other) => {
      if (change === 'receipt-missing') {
        other.git(['rm', 'config/open-source-baseline.json'])
      }
      if (change === 'receipt-changed') {
        other.write('config/open-source-baseline.json', {
          ...other.receipt,
          sourceCommit: 'f'.repeat(40)
        })
      }
      if (change === 'ledger-changed') {
        other.write('config/upstream-change-ledger.json', { schemaVersion: 1, entries: [] })
      }
      if (change === 'cursor-changed' || change === 'pending-changed') {
        const state = JSON.parse(
          readFileSync(path.join(other.cwd, 'config/upstream-sync-state.json'))
        )
        other.write('config/upstream-sync-state.json', {
          ...state,
          ...(change === 'cursor-changed'
            ? { lastReviewedUpstreamSha: 'f'.repeat(40) }
            : { pendingShas: [] })
        })
      }
    })
    expect(() => collectImportedAdaptations({ git: f.git, head })).toThrow()
  })

  it('verifies real new tree absorption after a reviewed multi-root merge and rejects tampering', async () => {
    const f = fixture()
    const target = mergePublicRoot(f)
    f.git(['checkout', '--detach', f.entry.upstreamSha])
    f.write('multi-root-fix.json', { fixed: true })
    const upstream = f.commit()
    f.git(['checkout', 'hivecode/main-next'])
    mkdirSync(path.join(f.cwd, 'docs'), { recursive: true })
    prepareUpstreamTreeSync({ cwd: f.cwd, target, upstream })
    const head = f.commit()
    const options = { cwd: f.cwd, stateRef: target, upstream, head }
    const report = await collectIntakeReport(options)
    expect(report.passed).toBe(true)
    expect(report.commits.find((row) => row.sha === upstream).evidence.kind).toBe(
      'verified-tree-absorption'
    )
    f.write('multi-root-fix.json', { fixed: false })
    await expect(collectIntakeReport({ ...options, head: f.commit() })).rejects.toThrow(
      'checkpoint'
    )
  }, 90000)

  it('retains actual historical adaptation identities without requiring old ancestry', () => {
    const f = fixture()
    const imported = collectImportedAdaptations({ git: f.git, head: f.root })
    expect(imported.get(f.entry.upstreamSha)).toEqual(f.entry)
    expect(f.git(['rev-list', '--count', f.root]).trim()).toBe('1')
  })

  it.each([false, true])(
    'does not grant evidence to modified or future entries with multiple roots: %s',
    (multipleRoots) => {
      const f = fixture()
      if (multipleRoots) {
        mergePublicRoot(f)
      }
      const future = { ...f.entry, upstreamSha: 'f'.repeat(40) }
      f.write('config/upstream-change-ledger.json', {
        schemaVersion: 1,
        entries: [{ ...f.entry, reviewReason: 'Changed claim' }, future]
      })
      const head = f.commit()
      expect(collectImportedAdaptations({ git: f.git, head }).size).toBe(0)
    }
  )

  it('rejects a rewritten import receipt and a mismatched original ledger blob', () => {
    const f = fixture()
    f.write('config/open-source-baseline.json', { ...f.receipt, sourceCommit: 'f'.repeat(40) })
    expect(() => collectImportedAdaptations({ git: f.git, head: f.commit() })).toThrow('immutable')
    const other = fixture()
    other.write('config/open-source-baseline.json', {
      ...other.receipt,
      ledgerBlob: 'f'.repeat(40)
    })
    other.git(['add', '.'])
    const root = other
      .git(['commit-tree', other.git(['write-tree']).trim(), '-m', 'Invalid root'])
      .trim()
    expect(() => collectImportedAdaptations({ git: other.git, head: root })).toThrow('ledger')
  })

  it('keeps ordinary product histories valid without a public baseline receipt', () => {
    const f = fixture()
    expect(collectImportedAdaptations({ git: f.git, head: f.receipt.sourceCommit }).size).toBe(0)
    expect(
      JSON.parse(readFileSync(path.join(f.cwd, 'config/upstream-sync-state.json'))).pendingShas
    ).toEqual([f.entry.upstreamSha])
  })

  it('rejects deletion of a receipt established by the public root', () => {
    const f = fixture()
    f.git(['rm', 'config/open-source-baseline.json'])
    expect(() => collectImportedAdaptations({ git: f.git, head: f.commit() })).toThrow('immutable')
  })

  it('rejects a second root after deleting the established public receipt', () => {
    const f = fixture()
    f.git(['rm', 'config/open-source-baseline.json'])
    const unrelated = f
      .git(['commit-tree', f.receipt.sourceTree, '-m', 'Independent fixture'])
      .trim()
    const head = f
      .git([
        'commit-tree',
        f.git(['write-tree']).trim(),
        '-p',
        f.root,
        '-p',
        unrelated,
        '-m',
        'Delete receipt while joining an independent history'
      ])
      .trim()
    expect(f.git(['rev-list', '--max-parents=0', head]).trim().split(/\s+/)).toHaveLength(2)
    expect(() => collectImportedAdaptations({ git: f.git, head })).toThrow('immutable')
    const ordinary = f
      .git([
        'commit-tree',
        f.receipt.sourceTree,
        '-p',
        f.receipt.sourceCommit,
        '-p',
        unrelated,
        '-m',
        'Ordinary history without a public baseline'
      ])
      .trim()
    expect(collectImportedAdaptations({ git: f.git, head: ordinary }).size).toBe(0)
  })

  it('keeps an original deferred feature pending after verified new tree absorption', async () => {
    const f = fixture('暂缓')
    f.git(['checkout', '--detach', f.receipt.reviewedUpstreamSha])
    f.write('new-fix.json', { fixed: true })
    const upstream = f.commit()
    f.git(['checkout', 'hivecode/main-next'])
    mkdirSync(path.join(f.cwd, 'docs'), { recursive: true })
    prepareUpstreamTreeSync({ cwd: f.cwd, target: f.root, upstream })
    const head = f.commit()
    const report = await collectIntakeReport({ cwd: f.cwd, stateRef: f.root, upstream, head })
    expect(report).toMatchObject({ passed: true, pendingShas: [f.entry.upstreamSha] })
    expect(report.commits.find((row) => row.sha === f.entry.upstreamSha)).toMatchObject({
      type: 'feature',
      disposition: 'deferred',
      review: { applied: '暂缓' },
      boundaryPaths: expect.arrayContaining([
        { path: 'config/product/pending-feature.json', classification: 'productBoundary' }
      ]),
      evidence: { kind: 'product-decision', boundaryConflict: 'maintained-capability' }
    })
    expect(report.commits.find((row) => row.sha === upstream).evidence.kind).toBe(
      'verified-tree-absorption'
    )
  }, 60000)

  it('carries a genuinely reviewed archived pending resolution through the orphan intake', async () => {
    const f = fixture()
    const report = await collectIntakeReport({
      cwd: f.cwd,
      stateRef: f.root,
      upstream: f.entry.upstreamSha
    })
    expect(report.passed).toBe(true)
    expect(report.commits[0].evidence.kind).toBe('archived-reviewed-adaptation')
  }, 60000)

  it('proves fresh upstream content on product-only history and refuses later tree tampering', async () => {
    const f = fixture()
    f.git(['checkout', '--detach', f.entry.upstreamSha])
    f.write('new-fix.json', { fixed: true })
    const upstream = f.commit()
    f.git(['checkout', 'hivecode/main-next'])
    mkdirSync(path.join(f.cwd, 'docs'), { recursive: true })
    f.git(['update-index', '--add', '--cacheinfo', '160000', f.receipt.sourceCommit, 'docs'])
    const tree = f.git(['write-tree']).trim()
    const target = f
      .git(['commit-tree', tree, '-m', 'Initial public fixture with private docs'])
      .trim()
    f.git(['update-ref', 'refs/heads/hivecode/main-next', target])
    prepareUpstreamTreeSync({ cwd: f.cwd, target, upstream })
    const head = f.commit()
    const options = { cwd: f.cwd, stateRef: target, upstream, head }
    const report = await collectIntakeReport(options)
    expect(report.passed).toBe(true)
    expect(report.commits.find((row) => row.sha === upstream).evidence.kind).toBe(
      'verified-tree-absorption'
    )
    expect(f.git(['rev-list', '--count', head]).trim()).toBe('2')
    f.write('new-fix.json', { fixed: false })
    await expect(collectIntakeReport({ ...options, head: f.commit() })).rejects.toThrow(
      'checkpoint'
    )
  }, 60000)
})
