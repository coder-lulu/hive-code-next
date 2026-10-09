import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runProcess } from '../../src/shared/child-process/run-process'
import {
  cleanupTestRepository,
  cleanupTestRepositoryPathFiles,
  linkedWorktreePaths
} from './global-teardown'

const roots: string[] = []
const childTerminations: Promise<void>[] = []
let operationSignal: AbortSignal | undefined
let pendingOperation: Promise<void> | undefined

async function git(cwd: string, args: string[]): Promise<void> {
  operationSignal?.throwIfAborted()
  const termination = Promise.withResolvers<void>()
  childTerminations.push(termination.promise)
  const result = await runProcess({
    program: 'git',
    args: ['-C', cwd, ...args],
    signal: operationSignal,
    timeoutMs: null,
    terminationBarrier: true,
    onChildTerminated: termination.resolve
  })
  if (result.code !== 0 || result.signal || operationSignal?.aborted) {
    throw new Error(result.stderr || 'Git operation interrupted')
  }
}

afterEach(async () => {
  await Promise.allSettled(pendingOperation ? [pendingOperation] : [])
  await Promise.all(childTerminations.splice(0))
  pendingOperation = undefined
  operationSignal = undefined
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('E2E global teardown ownership', () => {
  let publicationsFixture: Awaited<ReturnType<typeof preparePublications>>
  let linkedFixture: Awaited<ReturnType<typeof prepareLinkedWorktrees>>

  beforeEach(async ({ task, signal }) => {
    operationSignal = signal
    pendingOperation = (async () => {
      if (task.name === 'cleans orphaned worker publications while preserving another run') {
        publicationsFixture = await preparePublications()
      } else {
        linkedFixture = await prepareLinkedWorktrees()
      }
    })()
    await pendingOperation
  })

  async function preparePublications() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-worker-teardown-'))
    roots.push(root)
    const runPathFile = path.join(root, 'run.txt')
    const ownedRepositories: string[] = []
    for (const name of ['seed', 'worker-0', 'worker-3']) {
      const repository = path.join(root, name)
      mkdirSync(repository)
      await git(repository, ['init'])
      ownedRepositories.push(repository)
    }
    const publications = [runPathFile, `${runPathFile}.worker-0`, `${runPathFile}.worker-3`]
    publications.forEach((publication, index) => {
      writeFileSync(publication, ownedRepositories[index]!)
    })
    const unrelatedRepo = path.join(root, 'unrelated')
    mkdirSync(unrelatedRepo)
    const unrelatedPublication = path.join(root, 'another-run.txt.worker-0')
    writeFileSync(unrelatedPublication, unrelatedRepo)

    return { runPathFile, ownedRepositories, publications, unrelatedRepo, unrelatedPublication }
  }

  async function prepareLinkedWorktrees() {
    const root = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-teardown-contract-'))
    roots.push(root)
    const repoPath = path.join(root, 'orca-e2e-repo-run')
    const firstWorktreePath = path.join(root, 'orca-e2e-worktree-owned')
    const secondWorktreePath = path.join(root, 'e2e-test-owned')
    const concurrentWorktreePath = path.join(root, 'orca-e2e-worktree-concurrent')
    const unrelatedTestPath = path.join(root, 'e2e-test-unrelated')
    mkdirSync(repoPath)
    mkdirSync(concurrentWorktreePath)
    mkdirSync(unrelatedTestPath)
    writeFileSync(path.join(repoPath, 'README.md'), 'fixture\n')
    await git(repoPath, ['init'])
    await git(repoPath, ['config', 'user.email', 'e2e@test.local'])
    await git(repoPath, ['config', 'user.name', 'E2E Test'])
    await git(repoPath, ['add', 'README.md'])
    await git(repoPath, ['commit', '-m', 'seed'])
    await git(repoPath, ['worktree', 'add', '-b', 'first-owned', firstWorktreePath])
    await git(repoPath, ['worktree', 'add', '-b', 'second-owned', secondWorktreePath])

    return {
      repoPath,
      firstWorktreePath,
      secondWorktreePath,
      concurrentWorktreePath,
      unrelatedTestPath
    }
  }

  it('cleans orphaned worker publications while preserving another run', () => {
    const { runPathFile, ownedRepositories, publications, unrelatedRepo, unrelatedPublication } =
      publicationsFixture

    cleanupTestRepositoryPathFiles(runPathFile)

    expect(ownedRepositories.every((repository) => !existsSync(repository))).toBe(true)
    expect(publications.every((publication) => !existsSync(publication))).toBe(true)
    expect(existsSync(unrelatedRepo)).toBe(true)
    expect(existsSync(unrelatedPublication)).toBe(true)
  })

  it('removes every linked run worktree and preserves unrelated siblings', () => {
    const {
      repoPath,
      firstWorktreePath,
      secondWorktreePath,
      concurrentWorktreePath,
      unrelatedTestPath
    } = linkedFixture

    expect(new Set(linkedWorktreePaths(repoPath))).toEqual(
      new Set([realpathSync.native(firstWorktreePath), realpathSync.native(secondWorktreePath)])
    )
    cleanupTestRepository(repoPath)

    expect(existsSync(repoPath)).toBe(false)
    expect(existsSync(firstWorktreePath)).toBe(false)
    expect(existsSync(secondWorktreePath)).toBe(false)
    expect(existsSync(concurrentWorktreePath)).toBe(true)
    expect(existsSync(unrelatedTestPath)).toBe(true)
  })
})
