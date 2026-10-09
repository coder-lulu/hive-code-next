import type * as childProcess from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { getBranchConflictKind } from './repo-branch-conflict'

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

describe('branch conflict real Git contract', () => {
  const tempPaths: string[] = []
  const childTerminations: Promise<void>[] = []
  let repoPath: string
  let head: string
  let operationSignal: AbortSignal
  let pendingSetup: Promise<void> | undefined
  let pendingSubject: Promise<void> | undefined

  async function git(...args: string[]): Promise<string> {
    operationSignal.throwIfAborted()
    const terminated = Promise.withResolvers<void>()
    childTerminations.push(terminated.promise)
    const result = await runProcess({
      program: 'git',
      args,
      cwd: repoPath,
      timeoutMs: null,
      signal: operationSignal,
      terminationBarrier: true,
      onChildTerminated: terminated.resolve
    })
    operationSignal.throwIfAborted()
    if (result.code !== 0 || result.signal !== null) {
      throw new Error(`Git fixture command failed: ${args.join(' ')}\n${result.stderr}`)
    }
    return result.stdout
  }

  beforeEach(async ({ signal }) => {
    operationSignal = signal
    repoPath = mkdtempSync(join(tmpdir(), 'orca-branch-conflict-'))
    tempPaths.push(repoPath)
    pendingSetup = (async () => {
      await git('init', '--quiet')
      await git('config', 'user.name', 'Orca Test')
      await git('config', 'user.email', 'orca@example.test')
      await git('config', 'commit.gpgSign', 'false')
      await git('config', 'core.hooksPath', '.git/no-hooks')
      writeFileSync(join(repoPath, 'fixture.txt'), 'base\n')
      await git('add', 'fixture.txt')
      await git('commit', '--quiet', '-m', 'base')
      head = (await git('rev-parse', 'HEAD')).trim()

      // Many remotes is the shape that used to cost one subprocess each.
      for (let index = 0; index < 12; index += 1) {
        await git('remote', 'add', `remote${index}`, 'https://example.test/repo.git')
      }
      await git('update-ref', 'refs/remotes/remote7/taken', head)
    })()
    await pendingSetup
  })

  afterEach(async () => {
    await Promise.allSettled([
      ...(pendingSetup ? [pendingSetup] : []),
      ...(pendingSubject ? [pendingSubject] : [])
    ])
    await Promise.all(childTerminations.splice(0))
    await Promise.all(subjectChildren.closed.splice(0))
    pendingSetup = undefined
    pendingSubject = undefined
    for (const path of tempPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true })
    }
  })

  it('decides remote conflicts from one batched probe across many remotes', async ({ signal }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      signal.throwIfAborted()
      await expect(getBranchConflictKind(repoPath, 'taken')).resolves.toBe('remote')
      signal.throwIfAborted()
      await expect(getBranchConflictKind(repoPath, 'free')).resolves.toBeNull()
      // The allowed base ref is the one remote spelling that is not a conflict.
      signal.throwIfAborted()
      await expect(
        getBranchConflictKind(repoPath, 'taken', 'refs/remotes/remote7/taken')
      ).resolves.toBeNull()

      await git('branch', 'local-only', head)
      signal.throwIfAborted()
      await expect(getBranchConflictKind(repoPath, 'local-only')).resolves.toBe('local')
    })()
    await pendingSubject
  })
})
