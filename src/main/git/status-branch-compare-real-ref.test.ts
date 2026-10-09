import { execFileSync, type ChildProcess } from 'node:child_process'
import type * as childProcess from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBranchCompare } from './status'
import { branchCompare } from '../../relay/git-handler-ops'
import { gitChangeListArgs, parseGitChangeList } from '../../shared/git-change-list'
import { createGitTestRunner } from '../../relay/git-handler-test-setup'

const subjectChildren = vi.hoisted<{ closed: Promise<void>[] }>(() => ({ closed: [] }))

vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>()
  const execFile = new Proxy(real.execFile, {
    apply(target, receiver, args: Parameters<typeof real.execFile>) {
      const child: ChildProcess = target.apply(receiver, args)
      const closed = Promise.withResolvers<void>()
      subjectChildren.closed.push(closed.promise)
      child.once('close', () => closed.resolve())
      child.once('error', () => {
        if (!child.pid) {
          closed.resolve()
        }
      })
      return child
    }
  })
  return { ...real, execFile }
})

const tempRoots: string[] = []
const equalCommitCase =
  'reports equal commits as empty on native and relay despite staged and unstaged changes'
const fixtureRunner = createGitTestRunner()
const pendingComparisons: Promise<unknown>[] = []
let equalFixture: { repo: string; oid: string } | undefined
let pendingSetup: Promise<void> | undefined

function git(repo: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function relayCompare(repo: string, baseRef: string) {
  return branchCompare(
    async (args, cwd) => ({ stdout: git(cwd, args), stderr: '' }),
    repo,
    baseRef,
    async (mergeBase, headOid) =>
      parseGitChangeList(git(repo, gitChangeListArgs(mergeBase, headOid)))
  )
}

beforeEach(async ({ task, signal }) => {
  if (task.name !== equalCommitCase) {
    return
  }
  fixtureRunner.useSignal(signal, null)
  pendingSetup = (async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'orca-equal-branch-compare-'))
    tempRoots.push(repo)
    await fixtureRunner.git(repo, ['init', '-q'])
    await fixtureRunner.git(repo, ['config', 'user.email', 'test@example.com'])
    await fixtureRunner.git(repo, ['config', 'user.name', 'Test User'])
    await fixtureRunner.git(repo, [
      '-c',
      'commit.gpgSign=false',
      'commit',
      '--allow-empty',
      '-m',
      'initial'
    ])
    await fixtureRunner.git(repo, ['branch', 'base'])
    await fixtureRunner.git(repo, ['checkout', '-q', '-b', 'feature'])
    const oid = (await fixtureRunner.git(repo, ['rev-parse', 'HEAD'])).trim()
    await writeFile(path.join(repo, 'changes.txt'), 'staged\n')
    await fixtureRunner.git(repo, ['add', 'changes.txt'])
    await writeFile(path.join(repo, 'changes.txt'), 'unstaged\n')
    equalFixture = { repo, oid }
  })()
  await pendingSetup
})

afterEach(async () => {
  await Promise.allSettled([
    ...(pendingSetup ? [pendingSetup] : []),
    ...pendingComparisons.splice(0)
  ])
  await fixtureRunner.settle()
  await Promise.all(subjectChildren.closed.splice(0))
  pendingSetup = undefined
  equalFixture = undefined
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('getBranchCompare real refs', () => {
  it(equalCommitCase, async ({ signal }) => {
    const { repo, oid } = equalFixture!
    const comparisons = [getBranchCompare(repo, 'base', { signal }), relayCompare(repo, 'base')]
    pendingComparisons.push(...comparisons)
    for (const result of await Promise.all(comparisons)) {
      expect(result).toEqual({
        summary: {
          baseRef: 'base',
          baseOid: oid,
          compareRef: 'feature',
          headOid: oid,
          mergeBase: oid,
          changedFiles: 0,
          commitsAhead: 0,
          commitsBehind: 0,
          status: 'ready'
        },
        entries: []
      })
    }
  })

  it('keeps the merge-base failure for identical blob tips on the relay', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'orca-blob-branch-compare-'))
    tempRoots.push(repo)
    git(repo, ['init', '-q'])
    await writeFile(path.join(repo, 'blob.txt'), 'not a commit\n')
    const oid = git(repo, ['hash-object', '-w', 'blob.txt'])
    await writeFile(path.join(repo, '.git', 'HEAD'), `${oid}\n`)

    await expect(relayCompare(repo, oid)).resolves.toMatchObject({
      summary: { headOid: oid, baseOid: oid, status: 'no-merge-base', mergeBase: null },
      entries: []
    })
  })

  it('preserves the raw oid of a remote-tracking ref that stores an annotated tag', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'orca-branch-compare-ref-'))
    tempRoots.push(root)
    const source = path.join(root, 'source')
    const client = path.join(root, 'client')

    execFileSync('git', ['init', '-q', source])
    git(source, ['config', 'user.email', 'test@example.com'])
    git(source, ['config', 'user.name', 'Test User'])
    git(source, ['config', 'commit.gpgSign', 'false'])
    git(source, ['config', 'tag.gpgSign', 'false'])
    git(source, ['commit', '--allow-empty', '-m', 'initial'])
    git(source, ['tag', '-a', 'annotated', '-m', 'annotated base'])
    execFileSync('git', ['clone', '-q', source, client])
    git(client, ['fetch', source, 'refs/tags/annotated:refs/remotes/origin/tagbase'])

    expect(git(client, ['branch', '-r', '--format=%(refname:short)']).split(/\r?\n/)).toContain(
      'origin/tagbase'
    )
    const rawOid = git(client, ['rev-parse', '--verify', 'refs/remotes/origin/tagbase'])
    const peeledOid = git(client, [
      'rev-parse',
      '--verify',
      '--quiet',
      'refs/remotes/origin/tagbase^{commit}'
    ])
    expect(rawOid).not.toBe(peeledOid)

    for (const result of await Promise.all([
      getBranchCompare(client, 'origin/tagbase'),
      relayCompare(client, 'origin/tagbase')
    ])) {
      expect(result.summary).toMatchObject({
        baseOid: rawOid,
        headOid: peeledOid,
        mergeBase: peeledOid,
        changedFiles: 0,
        commitsAhead: 0,
        commitsBehind: 0,
        status: 'ready'
      })
    }
  })
})
