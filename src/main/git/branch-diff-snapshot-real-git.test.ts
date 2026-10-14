import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGitTestRunner } from './test-fixtures/git-test-runner'
import { getBranchCompare, getBranchDiff } from './status'
import type { GitDiffResult, GitBranchCompareResult } from '../../shared/git-diff-compare-types'

const fixtureGit = createGitTestRunner()
const fixtureRoots: string[] = []
let operationSignal: AbortSignal | undefined
const pendingReads = new Set<Promise<unknown>>()
let pendingPaths: Promise<void>[] = []

function trackRead<T>(promise: Promise<T>): Promise<T> {
  pendingReads.add(promise)
  void promise.then(
    () => pendingReads.delete(promise),
    () => pendingReads.delete(promise)
  )
  return promise
}

async function gitInit(repo: string): Promise<void> {
  await fixtureGit.git(repo, ['init'])
  await fixtureGit.git(repo, ['config', 'user.email', 'test@test.com'])
  await fixtureGit.git(repo, ['config', 'user.name', 'Test'])
}

async function gitCommit(repo: string, message: string): Promise<void> {
  await fixtureGit.git(repo, ['add', '.'])
  await fixtureGit.git(repo, [
    '-c',
    'user.email=test@test.com',
    '-c',
    'user.name=Test',
    'commit',
    '-m',
    message,
    '--allow-empty'
  ])
}

// Why this file exists: the current source-control owner supports pinned object IDs instead of a relay route's own
// `diff --name-status -M -C` rediscovery with values the caller already holds.
// These tests drive the real product contract against real Git and assert the
// two routes agree entry-for-entry, so "SSH still renders what it used to" is
// evidence rather than an argument about call sites.



async function git(repoPath: string, args: string[]): Promise<string> {
  return fixtureGit.git(repoPath, args)
}

/**
 * Builds one repo whose base..head range exercises every shape the review
 * panel can hand to a single-file branch diff.
 */
async function buildScenarioRepo(): Promise<{ repoPath: string; baseOid: string }> {
  const repoPath = mkdtempSync(path.join(tmpdir(), 'relay-branch-diff-equivalence-'))
  fixtureRoots.push(repoPath)
  await gitInit(repoPath)

  const write = (relativePath: string, contents: string | Buffer): void => {
    const target = path.join(repoPath, relativePath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
  }

  write('modified.txt', 'before\n')
  write('deleted.txt', 'doomed\n')
  write('renamed-from.txt', 'stable rename payload\n')
  write('renamed-and-edited-from.txt', 'rename plus edit, line one\nline two\nline three\n')
  write('copied-source.txt', 'copy me, line one\nline two\nline three\nline four\n')
  write('nested/deep/inner.txt', 'nested before\n')
  write('spaced name.txt', 'spaced before\n')
  write('ünïcode-ページ.txt', 'unicode before\n')
  write('binary-modified.bin', Buffer.from([0, 1, 2, 3, 0, 255]))
  write('binary-deleted.bin', Buffer.from([9, 8, 7, 0]))
  write('emptied.txt', 'about to be emptied\n')
  write('crlf.txt', 'crlf before\r\nsecond line\r\n')
  write('mode-changed.sh', '#!/bin/sh\necho hi\n')
  await gitCommit(repoPath, 'base')
  const baseOid = (await git(repoPath, ['rev-parse', 'HEAD'])).trim()

  write('modified.txt', 'after\n')
  rmSync(path.join(repoPath, 'deleted.txt'))
  rmSync(path.join(repoPath, 'binary-deleted.bin'))
  await git(repoPath, ['mv', 'renamed-from.txt', 'renamed-to.txt'])
  await git(repoPath, ['mv', 'renamed-and-edited-from.txt', 'renamed-and-edited-to.txt'])
  write('renamed-and-edited-to.txt', 'rename plus edit, line one\nline two CHANGED\nline three\n')
  write('copied-target.txt', 'copy me, line one\nline two\nline three\nline four\n')
  write('added.txt', 'brand new\n')
  write('binary-added.bin', Buffer.from([4, 4, 0, 4]))
  write('binary-modified.bin', Buffer.from([0, 1, 2, 3, 0, 254]))
  write('nested/deep/inner.txt', 'nested after\n')
  write('spaced name.txt', 'spaced after\n')
  write('ünïcode-ページ.txt', 'unicode after\n')
  write('emptied.txt', '')
  write('crlf.txt', 'crlf after\r\nsecond line\r\n')
  await git(repoPath, ['update-index', '--chmod=+x', 'mode-changed.sh'])
  await gitCommit(repoPath, 'head')

  return { repoPath, baseOid }
}

describe('current host pinned branch diff against real Git', () => {
  let repoPath = ''
  let baseOid = ''
  let pendingSetup: Promise<{ repoPath: string; baseOid: string }> | undefined
  let pendingSubject: Promise<void> | undefined

  beforeEach(async ({ signal }) => {
    operationSignal = signal
    fixtureGit.useSignal(signal, null)
    pendingSetup = buildScenarioRepo()
    const built = await pendingSetup
    repoPath = built.repoPath
    baseOid = built.baseOid
  })

  afterEach(async () => {
    await Promise.allSettled([
      ...(pendingSetup ? [pendingSetup] : []),
      ...(pendingSubject ? [pendingSubject] : []),
      ...pendingPaths
    ])
    await Promise.allSettled(pendingReads)
    await fixtureGit.settle()
    for (const root of fixtureRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
    pendingSetup = undefined
    pendingSubject = undefined
    pendingPaths = []
    repoPath = ''
  })

  async function branchCompare(): Promise<GitBranchCompareResult> {
    return trackRead(getBranchCompare(repoPath, baseOid, { signal: operationSignal }))
  }

  async function branchDiff(params: { filePath: string; oldPath?: string; baseRef?: string | null; headOid?: string | null }): Promise<GitDiffResult[]> {
    const headOid = params.headOid ?? (await git(repoPath, ['rev-parse', 'HEAD'])).trim()
    return [await trackRead(getBranchDiff(repoPath, { headOid, mergeBase: params.baseRef ?? baseOid, filePath: params.filePath, oldPath: params.oldPath }, { signal: operationSignal }))]
  }

  it('produces identical results for every changed file the review panel can open', async ({
    signal
  }) => {
    operationSignal = signal
    fixtureGit.useSignal(signal)
    pendingSubject = (async () => {
      const compare = await branchCompare()
      expect(compare.summary.status).toBe('ready')
      // Guard the guard: a truncated scenario set would make this test vacuously pass.
      expect(compare.entries.length).toBeGreaterThanOrEqual(14)

      const divergences: string[] = []
      pendingPaths = compare.entries.map(async (entry) => {
        // Exactly what the renderer sends: paths from the compare entry list,
        // OIDs from the compare summary that produced that same list.
        const callerParams = { filePath: entry.path, oldPath: entry.oldPath }
        const freshSnapshot = await branchDiff(callerParams)
        const pinned = await branchDiff({
          ...callerParams,
          baseRef: compare.summary.mergeBase,
          headOid: compare.summary.headOid
        })

        if (JSON.stringify(freshSnapshot) !== JSON.stringify(pinned)) {
          divergences.push(
            `${entry.status} ${entry.path}${entry.oldPath ? ` (from ${entry.oldPath})` : ''}\n` +
              `  freshSnapshot: ${JSON.stringify(freshSnapshot)}\n  pinned: ${JSON.stringify(pinned)}`
          )
        }
      })
      await Promise.all(pendingPaths)

      expect(divergences.join('\n')).toBe('')
    })()
    await pendingSubject
  })

  it('agrees on content for renames, additions, deletions and binaries specifically', async ({
    signal
  }) => {
    operationSignal = signal
    fixtureGit.useSignal(signal)
    pendingSubject = (async () => {
      const compare = await branchCompare()
      const byPath = new Map(compare.entries.map((entry) => [entry.path, entry]))

      // Why assert content and not just equality: two identically-empty results
      // would satisfy the equivalence test above while rendering nothing.
      const rename = byPath.get('renamed-and-edited-to.txt')
      expect(rename?.oldPath).toBe('renamed-and-edited-from.txt')
      const [renamePinned] = await branchDiff({
        baseRef: compare.summary.mergeBase,
        headOid: compare.summary.headOid,
        filePath: rename!.path,
        oldPath: rename!.oldPath
      })
      expect(renamePinned).toMatchObject({
        originalContent: 'rename plus edit, line one\nline two\nline three\n',
        modifiedContent: 'rename plus edit, line one\nline two CHANGED\nline three\n'
      })

      const [addedPinned] = await branchDiff({
        baseRef: compare.summary.mergeBase,
        headOid: compare.summary.headOid,
        filePath: 'added.txt'
      })
      expect(addedPinned).toMatchObject({ originalContent: '', modifiedContent: 'brand new\n' })

      const [deletedPinned] = await branchDiff({
        baseRef: compare.summary.mergeBase,
        headOid: compare.summary.headOid,
        filePath: 'deleted.txt'
      })
      expect(deletedPinned).toMatchObject({ originalContent: 'doomed\n', modifiedContent: '' })

      const [binaryPinned] = await branchDiff({
        baseRef: compare.summary.mergeBase,
        headOid: compare.summary.headOid,
        filePath: 'binary-modified.bin'
      })
      expect(binaryPinned).toMatchObject({ kind: 'binary' })
    })()
    await pendingSubject
  })

  it('holds the pinned revision when HEAD moves mid-review, where freshSnapshot drifts', async ({
    signal
  }) => {
    operationSignal = signal
    fixtureGit.useSignal(signal)
    pendingSubject = (async () => {
      const compare = await branchCompare()
      writeFileSync(path.join(repoPath, 'modified.txt'), 'drifted after the snapshot\n')
      await gitCommit(repoPath, 'drift')

      const pinned = await branchDiff({
        baseRef: compare.summary.mergeBase,
        headOid: compare.summary.headOid,
        filePath: 'modified.txt'
      })
      const freshSnapshot = await branchDiff({ filePath: 'modified.txt' })

      expect(pinned[0]).toMatchObject({ modifiedContent: 'after\n' })
      // The divergence is the fix: freshSnapshot silently re-resolves live HEAD.
      expect(freshSnapshot[0]).toMatchObject({ modifiedContent: 'drifted after the snapshot\n' })
    })()
    await pendingSubject
  })
})
