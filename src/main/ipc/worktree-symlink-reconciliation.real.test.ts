import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { findCreatedWorktree } from './created-worktree-reconciliation'
import { areWorktreePathsEqual } from './worktree-path-comparison'

type ListedWorktree = { path: string; branch?: string }

const fixtureRoots: string[] = []
const childTerminations: Promise<void>[] = []
let operationSignal: AbortSignal | undefined
let pendingOperation: Promise<void> | undefined
let repoPath = ''
let canonicalRoot = ''
let requestedPath = ''

afterEach(async () => {
  await Promise.allSettled(pendingOperation ? [pendingOperation] : [])
  await Promise.all(childTerminations.splice(0))
  pendingOperation = undefined
  operationSignal = undefined
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { force: true, recursive: true }))
  )
})

describe('native worktree symlink reconciliation (real Git)', () => {
  beforeEach(async ({ signal }) => {
    operationSignal = signal
    pendingOperation = prepareFixture()
    await pendingOperation
  })

  async function prepareFixture(): Promise<void> {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'pr-10172-real-git-'))
    fixtureRoots.push(fixtureRoot)
    repoPath = join(fixtureRoot, 'repo')
    canonicalRoot = join(fixtureRoot, 'canonical-worktrees')
    const aliasRoot = join(fixtureRoot, 'visible-worktrees')
    const stalePath = join(aliasRoot, 'aaa-stale')
    requestedPath = join(aliasRoot, 'feature')
    await mkdir(repoPath)
    await mkdir(canonicalRoot)
    await symlink(canonicalRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')

    await git(repoPath, ['init', '--quiet'])
    await git(repoPath, ['config', 'user.email', 'review@example.invalid'])
    await git(repoPath, ['config', 'user.name', 'PR review'])
    await writeFile(join(repoPath, 'README.md'), 'fixture\n')
    await git(repoPath, ['add', 'README.md'])
    await git(repoPath, ['commit', '--quiet', '-m', 'fixture'])
    await git(repoPath, [
      '-c',
      'maintenance.auto=false',
      'worktree',
      'add',
      '--quiet',
      '-b',
      'stale',
      stalePath,
      'HEAD'
    ])
    await rm(stalePath, { force: true, recursive: true })
  }

  it('matches the authoritative listed row after adding through a symlink root', async ({
    signal
  }) => {
    operationSignal = signal
    pendingOperation = reconcileCreatedWorktree()
    await pendingOperation
  })

  async function reconcileCreatedWorktree(): Promise<void> {
    await git(repoPath, [
      '-c',
      'maintenance.auto=false',
      'worktree',
      'add',
      '--quiet',
      '-b',
      'feature',
      requestedPath,
      'HEAD'
    ])

    const listedRows = parseListedWorktrees(
      await git(repoPath, ['worktree', 'list', '--porcelain'])
    )
    const listed = listedRows.find((worktree) => worktree.branch === 'refs/heads/feature')
    if (!listed) {
      throw new Error('Created worktree missing from Git listing')
    }
    const staleIndex = listedRows.findIndex((worktree) => worktree.branch === 'refs/heads/stale')
    const createdIndex = listedRows.indexOf(listed)
    expect(staleIndex).toBeGreaterThanOrEqual(0)
    expect(createdIndex).toBeGreaterThan(staleIndex)
    expect(await realpath(listed.path)).toBe(await realpath(requestedPath))
    if (process.platform !== 'win32') {
      expect(listed.path).toBe(join(await realpath(canonicalRoot), 'feature'))
      expect(areWorktreePathsEqual(listed.path, requestedPath)).toBe(false)
    }
    expect(findCreatedWorktree(listedRows, requestedPath, 'feature')).toBe(listed)
  }
})

async function git(repoPath: string, args: string[]): Promise<string> {
  operationSignal?.throwIfAborted()
  const termination = Promise.withResolvers<void>()
  childTerminations.push(termination.promise)
  const result = await runProcess({
    program: 'git',
    args: ['-C', repoPath, ...args],
    signal: operationSignal,
    timeoutMs: null,
    terminationBarrier: true,
    onChildTerminated: termination.resolve
  })
  if (result.code !== 0 || result.signal || operationSignal?.aborted) {
    throw new Error(result.stderr || 'Git operation interrupted')
  }
  return result.stdout
}

function parseListedWorktrees(output: string): ListedWorktree[] {
  return output
    .trim()
    .split('\n\n')
    .map((block) => {
      const pathLine = block.split('\n').find((line) => line.startsWith('worktree '))
      const branchLine = block.split('\n').find((line) => line.startsWith('branch '))
      if (!pathLine) {
        throw new Error(`Malformed Git worktree listing:\n${output}`)
      }
      return {
        path: pathLine.slice('worktree '.length),
        ...(branchLine ? { branch: branchLine.slice('branch '.length) } : {})
      }
    })
}
