import type * as childProcess from 'node:child_process'
import { createGitTestRunner } from '../../relay/git-handler-test-setup'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS } from '../../shared/git-fetch-auto-maintenance'
import {
  measureRetargetDivergence,
  RETARGET_MAX_COMMIT_DIVERGENCE
} from './worktree-base-divergence'

const tempRoots: string[] = []
const fixtureGit = createGitTestRunner()
let repoPath: string
let pendingSetup: Promise<void> | undefined
let pendingSubject: Promise<void> | undefined

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

// Why the maintenance suppression: `git commit` detaches `git maintenance run --auto`, and its
// commit-graph task arms once a fixture crosses 100 new commits — which the cap-sized histories
// below always do. That detached process keeps writing `.git/objects/info/commit-graphs` after the
// synchronous exec has returned, so it re-creates entries under a `.git/objects` the temp-root
// teardown is midway through deleting, and the recursive remove dies with ENOTEMPTY.
async function git(cwd: string, args: string[]): Promise<string> {
  return (
    await fixtureGit.git(cwd, [...GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS, ...args])
  ).trim()
}

async function createRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'orca-base-divergence-'))
  tempRoots.push(root)
  const repoPath = join(root, 'repo')
  await fixtureGit.git(process.cwd(), ['init', '--quiet', repoPath])
  await git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(repoPath, ['config', 'user.email', 'test@example.com'])
  await git(repoPath, ['config', 'user.name', 'Test User'])
  await writeFile(join(repoPath, 'version.txt'), 'one\n')
  await git(repoPath, ['add', 'version.txt'])
  await git(repoPath, ['commit', '--quiet', '-m', 'initial'])
  return repoPath
}

// Why unique across calls: an empty commit's hash covers only parent, tree, message and a
// one-second-granularity timestamp. On a fast runner the whole 100-commit build finishes inside
// one second, so a post-reset `commit 0` off the same fork point hashed identically to the first
// `commit 0` of the chain and Git handed back that same object — leaving the branch 99/0 apart
// instead of 100/1.
let emptyCommitSequence = 0

async function commitEmpty(repoPath: string, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    emptyCommitSequence += 1
    await git(repoPath, [
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      `commit ${emptyCommitSequence}`
    ])
  }
}

beforeEach(async ({ signal, task }) => {
  fixtureGit.useSignal(signal, null)
  pendingSetup = (async () => {
    repoPath = await createRepo()
    if (task.name === 'allows the drift between a local branch and its remote-tracking copy') {
      await git(repoPath, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await commitEmpty(repoPath, 5)
      await git(repoPath, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await git(repoPath, ['reset', '--hard', '--quiet', 'HEAD~3'])
    } else if (task.name === 'counts drift in both directions') {
      const forkPoint = await git(repoPath, ['rev-parse', 'HEAD'])
      await commitEmpty(repoPath, RETARGET_MAX_COMMIT_DIVERGENCE)
      await git(repoPath, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await git(repoPath, ['reset', '--hard', '--quiet', forkPoint])
      await commitEmpty(repoPath, 1)
    } else if (task.name === 'refuses a base that has drifted past the cap') {
      await git(repoPath, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
      await commitEmpty(repoPath, RETARGET_MAX_COMMIT_DIVERGENCE + 1)
    } else if (task.name === 'refuses unrelated histories, which share no commits at all') {
      await git(repoPath, ['checkout', '--quiet', '--orphan', 'unrelated'])
      await git(repoPath, ['commit', '--quiet', '--allow-empty', '-m', 'unrelated root'])
    }
  })()
  await pendingSetup
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
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('measureRetargetDivergence with real Git', () => {
  it('allows the drift between a local branch and its remote-tracking copy', async ({ signal }) => {
    pendingSubject = (async () => {
      await expect(
        measureRetargetDivergence(repoPath, 'refs/heads/main', 'refs/remotes/origin/main', {
          signal
        })
      ).resolves.toBe('within')
    })()
    await pendingSubject
  })

  it('counts drift in both directions', async ({ signal }) => {
    pendingSubject = (async () => {
      // 100 ahead + 1 behind is over the cap even though neither side alone exceeds it.
      await expect(
        measureRetargetDivergence(repoPath, 'refs/heads/main', 'refs/remotes/origin/main', {
          signal
        })
      ).resolves.toBe('exceeded')
    })()
    await pendingSubject
  })

  it('refuses a base that has drifted past the cap', async ({ signal }) => {
    pendingSubject = (async () => {
      await expect(
        measureRetargetDivergence(repoPath, 'refs/remotes/origin/main', 'refs/heads/main', {
          signal
        })
      ).resolves.toBe('exceeded')
    })()
    await pendingSubject
  })

  it('refuses unrelated histories, which share no commits at all', async ({ signal }) => {
    pendingSubject = (async () => {
      await expect(
        measureRetargetDivergence(repoPath, 'refs/heads/main', 'refs/heads/unrelated', { signal })
      ).resolves.toBe('exceeded')
    })()
    await pendingSubject
  })

  it('reports an unreadable ref as unverifiable, not as excess drift', async ({ signal }) => {
    pendingSubject = (async () => {
      await expect(
        measureRetargetDivergence(repoPath, 'refs/heads/main', 'refs/heads/missing', { signal })
      ).resolves.toBe('unknown')
    })()
    await pendingSubject
  })
})
