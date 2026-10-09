/**
 * Main and relay must publish the same `branchLineTotal` for the same fixture
 * repo. Both call sites
 * share `src/shared/git-branch-line-total.ts`; this is the test that catches one
 * of them wiring it up differently — different flags, a different untracked
 * source, a different completeness gate.
 */
import type * as childProcess from 'node:child_process'
import { runProcess } from '../../shared/child-process/run-process'
import { createGitTestRunner } from '../../relay/git-handler-test-setup'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getStatus } from './status'
import type { GitExec } from '../../relay/git-handler-ops'
import { getStatusOp } from '../../relay/git-handler-status-ops'
import type { RelayGitStreamExec } from '../../relay/git-stdout-stream'
import { invalidateGitBranchLineTotalInFlight } from '../../shared/git-branch-line-total'
import { clearGitStatusLineStatsCache } from '../../shared/git-status-line-stats-cache'

const fixtureGit = createGitTestRunner()
const relayChildren: Promise<void>[] = []
let operationSignal: AbortSignal | undefined

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

const relayGit: GitExec = async (args, cwd, opts) => {
  const terminated = Promise.withResolvers<void>()
  relayChildren.push(terminated.promise)
  const result = await runProcess({
    program: 'git',
    args,
    cwd,
    signal: opts?.signal ?? operationSignal,
    timeoutMs: opts?.timeout ?? null,
    terminationBarrier: true,
    onChildTerminated: terminated.resolve
  })
  if (result.code !== 0 || result.signal || result.timedOut) {
    throw new Error(result.stderr || 'Relay status Git command failed.')
  }
  const { stdout, stderr } = result

  return { stdout, stderr }
}

const relayStreamGit: RelayGitStreamExec = async (args, cwd, options) => {
  const { stdout } = await relayGit(args, cwd, {
    disableOptionalLocks: options.disableOptionalLocks,
    signal: options.signal
  })
  return { stoppedEarly: options.onStdout(stdout) === true }
}

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

describe('branch line total parity between main and relay', () => {
  let repo: string
  let mergeBase: string
  let pendingSetup: Promise<string> | undefined
  let pendingSubject: Promise<void> | undefined

  beforeEach(async ({ signal }) => {
    operationSignal = signal
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
    await Promise.all(relayChildren.splice(0))
    await Promise.all(subjectChildren.closed.splice(0))
    pendingSetup = undefined
    pendingSubject = undefined

    clearGitStatusLineStatsCache()
    invalidateGitBranchLineTotalInFlight()
    await rm(repo, { recursive: true, force: true })
  })

  it('produces identical totals for the same fixture repo', async ({ signal }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { branchLineTotalMergeBase: mergeBase, signal })
      clearGitStatusLineStatsCache()
      const relayStatus = await getStatusOp(
        relayGit,
        relayStreamGit,
        {
          worktreePath: repo,
          branchLineTotalMergeBase: mergeBase
        },
        { signal }
      )

      expect(mainStatus.branchLineTotal).toEqual({ ...EXPECTED_TOTAL, mergeBase })
      expect(relayStatus.branchLineTotal).toEqual(mainStatus.branchLineTotal)
      // Both sides model the same worktree, so a parity pass on a mismatched
      // entry list would be meaningless.
      expect(relayStatus.entries.map((entry) => entry.path).sort()).toEqual(
        mainStatus.entries.map((entry) => entry.path).sort()
      )
    })()
    await pendingSubject
  })

  it('agrees on a number no per-area row sum could produce', async ({ signal }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { branchLineTotalMergeBase: mergeBase, signal })
      clearGitStatusLineStatsCache()
      const relayStatus = await getStatusOp(
        relayGit,
        relayStreamGit,
        {
          worktreePath: repo,
          branchLineTotalMergeBase: mergeBase
        },
        { signal }
      )

      expect(sumAreaRows(mainStatus.entries)).toEqual(AREA_ROW_SUM)
      expect(sumAreaRows(relayStatus.entries as { added?: number; removed?: number }[])).toEqual(
        AREA_ROW_SUM
      )
      expect(mainStatus.branchLineTotal).not.toMatchObject(AREA_ROW_SUM)
      expect(relayStatus.branchLineTotal).toEqual(mainStatus.branchLineTotal)
    })()
    await pendingSubject
  })

  it('omits the total on both sides when no merge base is requested', async ({ signal }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      const mainStatus = await getStatus(repo, { signal })
      clearGitStatusLineStatsCache()
      const relayStatus = await getStatusOp(
        relayGit,
        relayStreamGit,
        { worktreePath: repo },
        { signal }
      )

      expect(Object.hasOwn(mainStatus, 'branchLineTotal')).toBe(false)
      expect(Object.hasOwn(relayStatus, 'branchLineTotal')).toBe(false)
    })()
    await pendingSubject
  })
})
