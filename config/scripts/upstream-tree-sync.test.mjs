import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGit, STATE_PATH } from './upstream-sync-checkpoint.mjs'
import {
  computeUpstreamTreeSync,
  prepareUpstreamTreeSync,
  verifyUpstreamTreeSync,
  TREE_SYNC_RECEIPT_PATH
} from './upstream-tree-sync.mjs'

const fixtureRoot = resolve(
  import.meta.dirname,
  '../../logs/open-source-baseline/tree-sync-fixtures'
)
const repos = []
const branch = 'hivecode/main-next'
const docsSha = 'b'.repeat(40)

function fixture(change = (f) => f.write('engine.txt', 'first\nmiddle\nupstream last\n')) {
  mkdirSync(fixtureRoot, { recursive: true })
  const cwd = mkdtempSync(join(fixtureRoot, 'repo-'))
  repos.push(cwd)
  const raw = createGit(cwd)
  const git = (args, input) => raw(args, input).trim()
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true })
    writeFileSync(join(cwd, file), contents)
  }
  const commit = (message, files = ['.']) => {
    git(['add', '--', ...files])
    git(['commit', '-m', message])
    return git(['rev-parse', 'HEAD'])
  }
  git(['init', '-b', 'upstream'])
  git(['config', 'user.name', 'Content Sync Fixture'])
  git(['config', 'user.email', 'content-sync@example.test'])
  git(['config', 'commit.gpgSign', 'false'])
  git(['config', 'core.autocrlf', 'false'])
  write('.gitignore', 'logs/\n')
  write('engine.txt', 'first\nmiddle\nlast\n')
  write('identity.txt', 'upstream\n')
  write('docs/reference.md', 'Upstream documentation\n')
  const base = commit('Upstream base')
  git(['checkout', '--orphan', branch])
  git(['rm', '-r', '--cached', '.'])
  rmSync(join(cwd, 'docs'), { recursive: true })
  write('engine.txt', 'product first\nmiddle\nlast\n')
  write('identity.txt', 'product\n')
  write(
    '.gitmodules',
    '[submodule "docs"]\n\tpath = docs\n\turl = https://example.test/private-docs.git\n'
  )
  write(
    STATE_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        upstream: 'stablyai/orca',
        targetBranch: branch,
        initialAuditCompleted: true,
        lastReviewedUpstreamSha: base,
        pendingShas: []
      },
      null,
      2
    )}\n`
  )
  git(['add', '.'])
  git(['update-index', '--add', '--cacheinfo', `160000,${docsSha},docs`])
  git(['commit', '-m', 'Independent public product root'])
  const target = git(['rev-parse', 'HEAD'])
  const f = { cwd, git, write, commit, base, target }
  git(['checkout', 'upstream'])
  change(f)
  const upstream = git(['status', '--porcelain'])
    ? commit('Upstream update')
    : git(['rev-parse', 'HEAD'])
  git(['checkout', branch])
  return { ...f, upstream, options: { cwd, target, upstream } }
}

function contentCommit(f) {
  const prepared = prepareUpstreamTreeSync(f.options)
  f.git(['commit', '-m', 'Absorb upstream content without importing history'])
  return { ...prepared, head: f.git(['rev-parse', 'HEAD']) }
}

function checkpoint(f) {
  const state = JSON.parse(readFileSync(join(f.cwd, STATE_PATH), 'utf8'))
  state.lastReviewedUpstreamSha = f.upstream
  f.write(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
  return f.commit('Activate reviewed checkpoint', [STATE_PATH])
}

afterEach(() => {
  for (const cwd of repos.splice(0)) {
    expect(cwd.startsWith(`${fixtureRoot}${process.platform === 'win32' ? '\\' : '/'}`)).toBe(true)
    rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

describe(
  'three-way upstream content absorption without shared public ancestry',
  { timeout: 60000 },
  () => {
    it('retains product edits and private docs while committing only a single product parent', () => {
      const f = fixture()
      expect(() => f.git(['merge-base', f.target, f.upstream])).toThrow()
      const before = f.git(['write-tree'])
      const computed = computeUpstreamTreeSync(f.options)
      expect(f.git(['write-tree'])).toBe(before)
      expect(f.git(['status', '--porcelain'])).toBe('')
      const { head, receipt } = contentCommit(f)
      expect(receipt.mergedTreeSha).toBe(computed.mergedTreeSha)
      expect(readFileSync(join(f.cwd, 'engine.txt'), 'utf8')).toBe(
        'product first\nmiddle\nupstream last\n'
      )
      expect(f.git(['show', `${head}:identity.txt`])).toBe('product')
      expect(f.git(['ls-tree', head, '--', 'docs'])).toBe(`160000 commit ${docsSha}\tdocs`)
      expect(f.git(['show', `${head}:.gitmodules`])).toBe(
        f.git(['show', `${f.target}:.gitmodules`])
      )
      expect(f.git(['rev-list', '--parents', '-n', '1', head])).toBe(`${head} ${f.target}`)
      expect(() => f.git(['merge-base', '--is-ancestor', f.upstream, head])).toThrow()
      expect(f.git(['for-each-ref', '--format=%(refname)', 'refs/replace/'])).toBe('')
      expect(verifyUpstreamTreeSync({ ...f.options, head })).toMatchObject({
        contentCommitSha: head,
        absorbedUpstreamShas: [f.upstream],
        checkpointOnly: false
      })
    })

    it('allows only state changes after the receipted content commit and uses the frozen cursor', () => {
      const f = fixture()
      const { head } = contentCommit(f)
      const candidate = checkpoint(f)
      expect(verifyUpstreamTreeSync({ ...f.options, head: candidate })).toMatchObject({
        contentCommitSha: head,
        absorbedUpstreamShas: [f.upstream]
      })
      f.write('unexpected.txt', 'unreviewed\n')
      const changed = f.commit('Unexpected post-proof code change', ['unexpected.txt'])
      expect(() => verifyUpstreamTreeSync({ ...f.options, head: changed })).toThrow(
        'Only the checkpoint state'
      )
    })

    it.each(['content', 'receipt', 'docs', 'receipt-mode'])(
      'rejects forged %s in the first absorption commit',
      (kind) => {
        const f = fixture()
        prepareUpstreamTreeSync(f.options)
        if (kind === 'content') {
          f.write('engine.txt', 'fabricated\n')
          f.git(['add', 'engine.txt'])
        } else if (kind === 'receipt') {
          const receipt = JSON.parse(readFileSync(join(f.cwd, TREE_SYNC_RECEIPT_PATH), 'utf8'))
          receipt.targetSha = f.base
          f.write(TREE_SYNC_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`)
          f.git(['add', TREE_SYNC_RECEIPT_PATH])
        } else if (kind === 'docs') {
          f.git(['update-index', '--cacheinfo', `160000,${'c'.repeat(40)},docs`])
        } else {
          f.git(['update-index', '--chmod=+x', TREE_SYNC_RECEIPT_PATH])
        }
        f.git(['commit', '-m', 'Forged absorption'])
        expect(() => verifyUpstreamTreeSync(f.options)).toThrow('recomputed content tree differs')
      }
    )

    it('rejects merge parents even when their tree matches the recomputed result', () => {
      const f = fixture()
      prepareUpstreamTreeSync(f.options)
      const tree = f.git(['write-tree'])
      const head = f.git(
        ['commit-tree', tree, '-p', f.target, '-p', f.upstream],
        'Forbidden merge\n'
      )
      expect(() => verifyUpstreamTreeSync({ ...f.options, head })).toThrow(
        'single-parent product commits'
      )
    })

    it('fails actual content conflicts without modifying the product index or worktree', () => {
      const f = fixture((repo) => repo.write('engine.txt', 'upstream first\nmiddle\nlast\n'))
      const before = f.git(['write-tree'])
      let failure
      try {
        prepareUpstreamTreeSync(f.options)
      } catch (error) {
        failure = error
      }
      expect(failure.message).toContain('individual product-boundary review')
      expect(failure.details.output).toContain('engine.txt')
      expect(f.git(['write-tree'])).toBe(before)
      expect(f.git(['status', '--porcelain'])).toBe('')
      expect(f.git(['rev-parse', 'HEAD'])).toBe(f.target)
    })

    it.each(['docs/reference.md', '.gitmodules'])(
      'blocks upstream %s changes pending private absorption',
      (file) => {
        const f = fixture((repo) => repo.write(file, 'Changed upstream documentation\n'))
        expect(() => prepareUpstreamTreeSync(f.options)).toThrow(
          'authenticated private documentation absorption'
        )
        expect(f.git(['status', '--porcelain'])).toBe('')
      }
    )

    it('still requires private review when upstream documentation changes were reverted', () => {
      const f = fixture((repo) => {
        repo.write('docs/reference.md', 'Temporary docs change\n')
        repo.commit('Update upstream docs')
        repo.write('docs/reference.md', 'Upstream documentation\n')
      })
      expect(() => computeUpstreamTreeSync(f.options)).toThrow(
        'authenticated private documentation absorption'
      )
    })

    it('merges upstream renames with existing product edits using the real Git rename engine', () => {
      const f = fixture((repo) => repo.git(['mv', 'engine.txt', 'renamed-engine.txt']))
      const { head } = contentCommit(f)
      expect(f.git(['show', `${head}:renamed-engine.txt`])).toBe('product first\nmiddle\nlast')
      expect(f.git(['ls-tree', head, '--', 'engine.txt'])).toBe('')
      expect(verifyUpstreamTreeSync(f.options).absorbedUpstreamShas).toEqual([f.upstream])
    })

    it('returns the exact new upstream interval including merged side branches', () => {
      const f = fixture((repo) => {
        repo.git(['checkout', '-b', 'upstream-side'])
        repo.write('side.txt', 'side branch\n')
        repo.commit('Side change')
        repo.git(['checkout', 'upstream'])
        repo.write('main.txt', 'main change\n')
        repo.commit('Main change')
        repo.git(['merge', '--no-ff', '--no-edit', 'upstream-side'])
      })
      const expected = f.git(['rev-list', '--reverse', `${f.base}..${f.upstream}`]).split(/\s+/)
      contentCommit(f)
      expect(verifyUpstreamTreeSync(f.options).absorbedUpstreamShas).toEqual(expected)
      expect(expected).toHaveLength(3)
    })

    it('verifies a product-only bundle after separately fetching the exact upstream proof objects', () => {
      const f = fixture()
      const { head } = contentCommit(f)
      const bundle = join(f.cwd, 'logs/candidate.bundle')
      mkdirSync(dirname(bundle), { recursive: true })
      f.git(['bundle', 'create', bundle, `refs/heads/${branch}`])
      const cwd = mkdtempSync(join(fixtureRoot, 'receiver-'))
      repos.push(cwd)
      f.git(['clone', '--branch', branch, bundle, cwd])
      const raw = createGit(cwd)
      const git = (args) => raw(args).trim()
      expect(git(['rev-parse', 'HEAD'])).toBe(head)
      expect(() => git(['cat-file', '-e', `${f.upstream}^{commit}`])).toThrow()
      expect(() => git(['cat-file', '-e', `${f.base}^{commit}`])).toThrow()
      git(['fetch', '--no-tags', f.cwd, f.upstream])
      expect(git(['rev-parse', 'FETCH_HEAD'])).toBe(f.upstream)
      expect(verifyUpstreamTreeSync({ ...f.options, cwd, head }).absorbedUpstreamShas).toEqual([
        f.upstream
      ])
      expect(() => git(['merge-base', '--is-ancestor', f.upstream, head])).toThrow()
    })

    it('permits a checkpoint-only no-op without claiming new upstream inclusion', () => {
      const f = fixture(() => {})
      expect(prepareUpstreamTreeSync(f.options)).toEqual({
        changed: false,
        receipt: null,
        absorbedUpstreamShas: []
      })
      const state = JSON.parse(readFileSync(join(f.cwd, STATE_PATH), 'utf8'))
      state.lastAudit = { reviewed: true }
      f.write(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
      const head = f.commit('Update pending boundary review', [STATE_PATH])
      expect(verifyUpstreamTreeSync({ ...f.options, head })).toMatchObject({
        checkpointOnly: true,
        absorbedUpstreamShas: []
      })
    })

    it('refuses dirty preparation, unfrozen refs and unreviewed initial history', () => {
      const f = fixture()
      f.write('untracked.txt', 'local work\n')
      expect(() => prepareUpstreamTreeSync(f.options)).toThrow('dirty product checkout')
      expect(() => computeUpstreamTreeSync({ ...f.options, upstream: 'upstream' })).toThrow(
        'exact frozen'
      )
      f.git(['checkout', 'upstream'])
      const rewritten = f.git(
        ['commit-tree', f.git(['rev-parse', `${f.upstream}^{tree}`])],
        'Rewritten upstream root\n'
      )
      expect(() => computeUpstreamTreeSync({ ...f.options, upstream: rewritten })).toThrow(
        'rewritten'
      )
      f.git(['checkout', branch])
      const state = JSON.parse(readFileSync(join(f.cwd, STATE_PATH), 'utf8'))
      Object.assign(state, { initialAuditCompleted: false, lastReviewedUpstreamSha: null })
      f.write(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`)
      const target = f.commit('Incomplete historical audit', [STATE_PATH])
      expect(() => computeUpstreamTreeSync({ ...f.options, target })).toThrow(
        'explicitly reconciled historical'
      )
    })

    it('rejects replacement refs that could alter apparent commit identity', () => {
      const f = fixture()
      f.git(['replace', f.upstream, f.base])
      expect(() => computeUpstreamTreeSync(f.options)).toThrow('replacement refs')
    })
  }
)
