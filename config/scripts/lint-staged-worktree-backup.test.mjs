import { createGitTestRunner } from '../../src/relay/git-handler-test-setup'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import lintStaged from 'lint-staged'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const BACKUP_REFS = 'refs/worktree/lint-staged-backups'
const silentLogger = { error() {}, log() {}, warn() {} }

const fixtureGit = createGitTestRunner()
const subjectChildren = vi.hoisted(() => ({ closed: [] }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal()
  const spawn = new Proxy(real.spawn, {
    apply(target, receiver, args) {
      const child = target.apply(receiver, args)
      const closed = Promise.withResolvers()
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
  return { ...real, spawn }
})

let root
let repo
let worktree
let trackedFile
let expectedStash
let stashBefore
let stagedBefore
let unstagedBefore
let contentBefore
let observation
let task
let pendingSetup
let pendingSubject
let pendingLint

beforeEach(async ({ signal }) => {
  fixtureGit.useSignal(signal, null)
  pendingSetup = (async () => {
    root = mkdtempSync(join(tmpdir(), 'orca-lint-staged-worktree-'))

    repo = join(root, 'repo')
    worktree = join(root, 'linked worktree')
    trackedFile = join(worktree, 'tracked.txt')
    mkdirSync(repo)
    await initializeRepo(repo)

    writeFileSync(join(repo, 'tracked.txt'), 'base-one\nbase-two\n')
    await git(repo, ['add', 'tracked.txt'])
    await git(repo, ['commit', '--quiet', '-m', 'initial'])
    writeFileSync(join(repo, 'tracked.txt'), 'user stash\nbase-two\n')
    await git(repo, ['stash', 'push', '--quiet', '--message', 'user backup'])
    await git(repo, ['worktree', 'add', '--quiet', '-b', 'linked', worktree])

    writeFileSync(trackedFile, 'staged-change\nbase-two\n')
    await git(worktree, ['add', 'tracked.txt'])
    writeFileSync(trackedFile, 'staged-change\nunstaged-change\n')

    expectedStash = await gitTrim(worktree, ['rev-parse', 'refs/stash'])
    stashBefore = await git(worktree, ['stash', 'list', '--format=%H%x00%gs'])
    stagedBefore = await git(worktree, ['diff', '--cached', '--binary'])
    unstagedBefore = await git(worktree, ['diff', '--binary'])
    contentBefore = readFileSync(trackedFile, 'utf8')
    observation = join(root, 'task-observation.json')
    const probe = join(root, 'failing-task.cjs')
    writeProbe(probe)

    task = [process.execPath, probe, expectedStash, observation].map(quote).join(' ')
  })()
  await pendingSetup
})

afterEach(async () => {
  await Promise.allSettled([
    ...(pendingSetup ? [pendingSetup] : []),
    ...(pendingSubject ? [pendingSubject] : []),
    ...(pendingLint ? [pendingLint] : [])
  ])
  await fixtureGit.settle()
  await Promise.all(subjectChildren.closed.splice(0))
  if (root) {
    rmSync(root, { force: true, recursive: true })
  }
  pendingSetup = undefined
  pendingSubject = undefined
  pendingLint = undefined
  root = undefined
})

it('keeps lint-staged backups isolated to the current worktree', async ({ signal }) => {
  fixtureGit.useSignal(signal)
  pendingSubject = (async () => {
    pendingLint = lintStaged(
      { config: { '*.txt': task }, cwd: worktree, quiet: true },
      silentLogger
    )
    const passed = await pendingLint

    expect(passed).toBe(false)
    expect(JSON.parse(readFileSync(observation, 'utf8'))).toEqual({
      backupRefs: [expect.stringMatching(`^${BACKUP_REFS}/`)],
      sharedStash: expectedStash
    })
    expect(await git(worktree, ['for-each-ref', '--format=%(refname)', BACKUP_REFS])).toBe('')
    expect(await git(worktree, ['stash', 'list', '--format=%H%x00%gs'])).toBe(stashBefore)
    expect(await git(worktree, ['diff', '--cached', '--binary'])).toBe(stagedBefore)
    expect(await git(worktree, ['diff', '--binary'])).toBe(unstagedBefore)
    expect(readFileSync(trackedFile, 'utf8')).toBe(contentBefore)
    expect(await git(worktree, ['ls-files', '--unmerged'])).toBe('')
  })()
  await pendingSubject
})

async function initializeRepo(repo) {
  await git(repo, ['init', '--quiet'])
  await git(repo, ['config', 'user.email', 'test@example.invalid'])
  await git(repo, ['config', 'user.name', 'Test'])
  await git(repo, ['config', 'core.autocrlf', 'false'])
  await git(repo, ['config', 'core.hooksPath', join(repo, '.git', 'no-hooks')])
  await git(repo, ['config', 'commit.gpgsign', 'false'])
}

function git(cwd, args) {
  return fixtureGit.git(cwd, args)
}

async function gitTrim(cwd, args) {
  return (await git(cwd, args)).trim()
}

function quote(value) {
  return JSON.stringify(value)
}

function writeProbe(path) {
  writeFileSync(
    path,
    [
      "const { execFileSync } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim()",
      "const backupRefs = git(['for-each-ref', '--format=%(refname)', 'refs/worktree/lint-staged-backups'])",
      "writeFileSync(process.argv[3], JSON.stringify({ backupRefs: backupRefs.split('\\n').filter(Boolean), sharedStash: git(['rev-parse', 'refs/stash']) }))",
      "writeFileSync(process.argv[4], 'task-output\\n')",
      'process.exit(1)'
    ].join('\n')
  )
}
