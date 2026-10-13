import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGit } from './upstream-sync-checkpoint.mjs'
import {
  applyFrozenTreeReview,
  reviewFileEntry,
  TREE_REVIEW_PATH
} from './upstream-tree-review.mjs'

const fixtureRoot = resolve(import.meta.dirname, '../../logs/upstream-sync/tree-review-fixtures')
const repos = []
function fixture(change = (f) => f.write('engine.txt', 'upstream\n')) {
  mkdirSync(fixtureRoot, { recursive: true })
  const cwd = mkdtempSync(join(fixtureRoot, 'repo-'))
  repos.push(cwd)
  const git = createGit(cwd)
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  const commit = (files = ['.']) => {
    git(['add', '--', ...files])
    git(['commit', '-m', 'Review fixture'])
    return git(['rev-parse', 'HEAD']).trim()
  }
  git(['init', '-b', 'product'])
  git(['config', 'user.name', 'Review Fixture'])
  git(['config', 'user.email', 'review@example.test'])
  git(['config', 'commit.gpgSign', 'false'])
  git(['config', 'core.autocrlf', 'false'])
  write('.gitignore', 'logs/\n')
  write('engine.txt', 'base\n')
  write('identity.txt', 'base\n')
  const base = commit()
  write('engine.txt', 'product\n')
  write('config/fixture.json', '{}\n')
  const target = commit()
  git(['checkout', '-b', 'upstream', base])
  const f = { cwd, git, write, commit, base, target }
  change(f)
  const upstream = git(['status', '--porcelain']).trim() ? commit() : base
  git(['checkout', 'product'])
  return { ...f, upstream }
}
function frozenReview(f, resolutions) {
  f.write(TREE_REVIEW_PATH, JSON.stringify({ resolutions }))
  return f.commit([TREE_REVIEW_PATH])
}
function resolution(f, path, contents) {
  return {
    path,
    base: reviewFileEntry(f.git, f.base, path),
    product: reviewFileEntry(f.git, f.target, path),
    upstream: reviewFileEntry(f.git, f.upstream, path),
    result: { mode: '100644', sha: f.git(['hash-object', '-w', '--stdin'], contents).trim() },
    reason: 'Verify frozen input identity and reviewed result availability.',
    regressionTests: ['config/scripts/upstream-tree-review.test.mjs']
  }
}
afterEach(() => {
  for (const cwd of repos.splice(0)) {
    expect(dirname(cwd)).toBe(fixtureRoot)
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
describe('frozen review tree indexing', { timeout: 60000 }, () => {
  it('reads each frozen tree once across existing, missing and nested resolution paths', () => {
    const f = fixture()
    const rows = ['engine.txt', 'identity.txt', 'nested/new.txt', 'absent.txt'].map((file) =>
      resolution(f, file, 'reviewed\n')
    )
    rows[3].result = null
    const target = frozenReview(f, rows)
    const calls = []
    const git = (args, input) => {
      calls.push(args)
      return f.git(args, input)
    }
    const context = { ...f, target, git }
    const mergedTree = f.git(['rev-parse', `${target}^{tree}`]).trim()
    const result = applyFrozenTreeReview(context, mergedTree, [], { resolutions: rows })
    expect(calls.filter((args) => args[0] === 'ls-tree')).toEqual(
      [f.base, target, f.upstream].map((ref) => ['ls-tree', '-r', '-t', '-z', ref])
    )
    for (const row of rows) {
      expect(reviewFileEntry(f.git, result.mergedTreeSha, row.path)).toEqual(row.result)
    }
    // A second invocation must independently re-read its frozen inputs.
    applyFrozenTreeReview(context, mergedTree, [], { resolutions: rows })
    expect(calls.filter((args) => args[0] === 'ls-tree')).toHaveLength(6)
  })

  it('does not alias a replacement-character path to an invalid UTF-8 Git filename', () => {
    const f = fixture()
    const path = 'file-\uFFFD.txt'
    const row = resolution(f, path, 'unused\n')
    row.result = null
    const blob = reviewFileEntry(f.git, f.base, 'engine.txt').sha
    const rawTree = Buffer.concat([
      Buffer.from(`100644 blob ${blob}\tfile-`),
      Buffer.from([0xff]),
      Buffer.from('.txt\0')
    ])
    const base = f.git(['mktree', '-z'], rawTree).trim()
    expect(reviewFileEntry(f.git, base, path)).toBeNull()
    const target = frozenReview(f, [row])
    const before = f.git(['write-tree']).trim()
    const result = applyFrozenTreeReview({ ...f, base, target }, before, [], { resolutions: [row] })
    expect(result.mergedTreeSha).toBe(before)
  })

  it('retains the original ambiguous-path rejection for an unpaired surrogate', () => {
    const f = fixture()
    const path = 'file-\uD800.txt'
    const row = resolution(f, path, 'unused\n')
    row.result = null
    const blob = reviewFileEntry(f.git, f.base, 'engine.txt').sha
    const base = f
      .git(['mktree', '-z'], Buffer.from(`100644 blob ${blob}\tfile-\uFFFD.txt\0`))
      .trim()
    expect(() => reviewFileEntry(f.git, base, path)).toThrow('Ambiguous review path')
    expect(() =>
      applyFrozenTreeReview({ ...f, base }, f.git(['write-tree']).trim(), [], {
        resolutions: [row]
      })
    ).toThrow('Ambiguous review path')
  })

  it('deduplicates identical frozen identities but never caches a mutable ref', () => {
    const f = fixture(() => {})
    const rows = ['engine.txt', 'identity.txt'].map((file) => resolution(f, file, 'reviewed\n'))
    frozenReview(f, rows)
    const calls = []
    const git = (args, input) => {
      calls.push(args)
      return f.git(args, input)
    }
    applyFrozenTreeReview({ ...f, target: 'HEAD', git }, f.git(['write-tree']).trim(), [], {
      resolutions: rows
    })
    expect(calls.filter((args) => args[0] === 'ls-tree')).toEqual([
      ['ls-tree', '-r', '-t', '-z', f.base],
      ['ls-tree', '-z', 'HEAD', '--', 'engine.txt'],
      ['ls-tree', '-z', 'HEAD', '--', 'identity.txt']
    ])
  })

  it.each(['mode', 'missing', 'directory', 'gitlink', 'result-tree', 'result-missing', 'markers'])(
    'preserves frozen entry and result rejection after tree indexing: %s',
    (kind) => {
      const f = fixture()
      const row = resolution(f, 'engine.txt', 'reviewed\n')
      let message = 'Frozen base entry differs'
      if (kind === 'mode') {
        row.base.mode = '100755'
      }
      if (kind === 'missing') {
        row.path = 'missing.txt'
      }
      if (kind === 'directory') {
        row.path = 'config'
        row.base = null
        message = 'Review paths must be files'
      }
      if (kind === 'gitlink') {
        f.git(['update-index', '--add', '--cacheinfo', `160000,${f.base},external`])
        f.git(['commit', '-m', 'Fixture gitlink'])
        f.target = f.git(['rev-parse', 'HEAD']).trim()
        row.path = 'external'
        row.base = null
        message = 'Review paths must be files'
      }
      if (kind === 'result-tree' || kind === 'result-missing') {
        row.result.sha =
          kind === 'result-tree' ? f.git(['rev-parse', `${f.base}^{tree}`]).trim() : '0'.repeat(40)
        message = 'Reviewed result blob unavailable'
      }
      if (kind === 'markers') {
        row.result.sha = f.git(['hash-object', '-w', '--stdin'], '<<<<<<< unresolved\n').trim()
        message = 'Unresolved conflict markers'
      }
      const target = frozenReview(f, [row])
      const before = f.git(['write-tree']).trim()
      expect(() =>
        applyFrozenTreeReview({ ...f, target }, before, [], { resolutions: [row] })
      ).toThrow(message)
      expect(f.git(['write-tree']).trim()).toBe(before)
    }
  )
})
