/** Real current-host status totals must not double-count staged and unstaged changes. */
import type * as childProcess from 'node:child_process'
import { createGitTestRunner } from "./test-fixtures/git-test-runner"
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStatus } from './status'
import { invalidateGitBranchLineTotalInFlight } from '../../shared/git-branch-line-total'
import { clearGitStatusLineStatsCache } from '../../shared/git-status-line-stats-cache'

const fixtureGit = createGitTestRunner()

const subjectChildren = vi.hoisted<{ closed: Promise<void>[] }>(() => ({ closed: [] }))

// Track actual close events while preserving the subject's default Git execution path.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof childProcess>()
  const execFile = new Proxy(real.execFile, {
    apply(target, receiver, args: Parameters<typeof real.execFile>) {
      const child = target.apply(receiver, args)
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

// Fork point → working tree for the fixture below:
//   tracked.txt  +2  (branch commit only)
//   partial.txt  +1  (staged +2 then one of those lines removed unstaged)
//   flip.txt      0  (added in the branch commit, removed again in the worktree)
//   moved.txt     0  (pure rename)
//   fresh.txt    +3  (untracked)
// No fixture path here looks like test or generated code, so it is all source.
const EXPECTED_TOTAL = {
  added: 6,
  removed: 0,
  test: { added: 0, removed: 0 },
  generated: { added: 0, removed: 0 }
}
// Summing the per-area status rows instead would give this — the wrong answer
// the shared module exists to avoid.
const AREA_ROW_SUM = { added: 5, removed: 2 }

async function runFixtureGit(repo: string, args: string[]): Promise<string> {
  return (
    await fixtureGit.git(repo, [
      '-c',
      'user.email=test@test.com',
      '-c',
      'user.name=Test',
      '-c',
      'commit.gpgSign=false',
      ...args
    ])
  ).trim()
}

/** Returns the merge-base OID the chip is measured against. */
async function seedParityFixture(repo: string): Promise<string> {
  await fixtureGit.git(process.cwd(), ['init', '-q', repo])
  await writeFile(path.join(repo, 'tracked.txt'), 'a\nb\n')
  await writeFile(path.join(repo, 'partial.txt'), 'one\ntwo\nthree\n')
  await writeFile(path.join(repo, 'renamed.txt'), 'stable\n')
  await writeFile(path.join(repo, 'flip.txt'), 'p\n')
  await runFixtureGit(repo, ['add', '.'])
  await runFixtureGit(repo, ['commit', '-m', 'base'])
  const mergeBase = await runFixtureGit(repo, ['rev-parse', 'HEAD'])

  await runFixtureGit(repo, ['checkout', '-q', '-b', 'feature'])
  await writeFile(path.join(repo, 'tracked.txt'), 'a\nb\nc\nd\n')
  await writeFile(path.join(repo, 'flip.txt'), 'p\nq\n')
  await runFixtureGit(repo, ['add', '-A'])
  await runFixtureGit(repo, ['commit', '-m', 'branch commit'])

  await runFixtureGit(repo, ['mv', 'renamed.txt', 'moved.txt'])
  // Staged and unstaged hunks land on the same added lines, so an area sum
  // double-counts them.
  await writeFile(path.join(repo, 'partial.txt'), 'one\ntwo\nthree\nfoo\nbaz\n')
  await runFixtureGit(repo, ['add', 'partial.txt'])
  await writeFile(path.join(repo, 'partial.txt'), 'one\ntwo\nthree\nfoo\n')
  // The branch commit's line, taken back out in the worktree: net zero.
  await writeFile(path.join(repo, 'flip.txt'), 'p\n')
  await writeFile(path.join(repo, 'fresh.txt'), 'n1\nn2\nn3\n')
  return mergeBase
}

function sumAreaRows(entries: readonly { added?: number; removed?: number }[]): {
  added: number
  removed: number
} {
  let added = 0
  let removed = 0
  for (const entry of entries) {
    added += entry.added ?? 0
    removed += entry.removed ?? 0
  }
  return { added, removed }
}

describe('current host branch line totals with real Git', () => {
  let repo: string
  let mergeBase: string
  let pendingSetup: Promise<string> | undefined
  let pendingSubject: Promise<void> | undefined

  beforeEach(async ({ signal }) => {
    fixtureGit.useSignal(signal, null)
    clearGitStatusLineStatsCache()
    invalidateGitBranchLineTotalInFlight()
    repo = await mkdtemp(path.join(tmpdir(), 'branch-line-total-parity-'))
    pendingSetup = seedParityFixture(repo)
    mergeBase = await pendingSetup
  })

  afterEach(async () => {
    await Promise.allSettled([
      ...(pendingSetup ? [pendingSetup] : []),
      ...(pendingSubject ? [pendingSubject] : [])
    ])
    await fixtureGit.settle()
    await Promise.all(subjectChildren.closed.splice(0))
    pendingSetup = undefined
    pendingSubject = undefined

    clearGitStatusLineStatsCache()
    invalidateGitBranchLineTotalInFlight()
    await rm(repo, { recursive: true, force: true })
  })

  it('includes committed, staged, unstaged, renamed and untracked fixture changes', async ({ signal }) => {
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { branchLineTotalMergeBase: mergeBase, signal })
      clearGitStatusLineStatsCache()

      expect(mainStatus.branchLineTotal).toEqual({ ...EXPECTED_TOTAL, mergeBase })
    })()
    await pendingSubject
  })

  it('computes a net total no per-area row sum could produce', async ({ signal }) => {
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { branchLineTotalMergeBase: mergeBase, signal })
      clearGitStatusLineStatsCache()

      expect(sumAreaRows(mainStatus.entries)).toEqual(AREA_ROW_SUM)
      expect(mainStatus.branchLineTotal).not.toMatchObject(AREA_ROW_SUM)
    })()
    await pendingSubject
  })

  it('omits the total when no merge base is requested', async ({ signal }) => {
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { signal })
      clearGitStatusLineStatsCache()

      expect(Object.hasOwn(mainStatus, 'branchLineTotal')).toBe(false)
    })()
    await pendingSubject
  })
})
