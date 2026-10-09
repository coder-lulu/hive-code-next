import type * as childProcess from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { getRecentDriftSubjects, getRemoteDrift } from './repo'

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

describe('remote drift real Git contract', () => {
  const tempPaths: string[] = []
  const childTerminations: Promise<void>[] = []
  let repoPath: string
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
    repoPath = mkdtempSync(join(tmpdir(), 'orca-remote-drift-'))
    tempPaths.push(repoPath)
    pendingSetup = (async () => {
      await git('init', '--quiet')
      await git('config', 'user.name', 'Orca Test')
      await git('config', 'user.email', 'orca@example.test')
      await git('config', 'commit.gpgSign', 'false')
      await git('config', 'core.hooksPath', '.git/no-hooks')
      writeFileSync(join(repoPath, 'fixture.txt'), 'base\n')
      await git('add', 'fixture.txt')
      await git('commit', '-m', 'base')
      await git('branch', '-M', 'fixture-base')
      await git('branch', 'feature')

      writeFileSync(join(repoPath, 'fixture.txt'), 'remote one\n')
      await git('commit', '-am', 'remote one')
      writeFileSync(join(repoPath, 'fixture.txt'), 'remote two\n')
      await git('commit', '-am', 'remote two')
      await git('update-ref', 'refs/remotes/origin/main', 'HEAD')

      await git('checkout', '--quiet', 'feature')
      writeFileSync(join(repoPath, 'local.txt'), 'local one\n')
      await git('add', 'local.txt')
      await git('commit', '-m', 'local one')
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

  it('preserves clean, diverged, and missing-ref results', async ({ signal }) => {
    pendingSubject = (async () => {
      signal.throwIfAborted()
      await expect(getRemoteDrift(repoPath, 'HEAD', 'origin/main')).resolves.toEqual({
        ahead: 1,
        behind: 2
      })
      signal.throwIfAborted()
      await expect(getRecentDriftSubjects(repoPath, 'HEAD', 'origin/main', 5)).resolves.toEqual([
        'remote two',
        'remote one'
      ])
      signal.throwIfAborted()
      await expect(getRemoteDrift(repoPath, 'origin/main', 'origin/main')).resolves.toEqual({
        ahead: 0,
        behind: 0
      })
      signal.throwIfAborted()
      await expect(
        getRecentDriftSubjects(repoPath, 'origin/main', 'origin/main', 5)
      ).resolves.toEqual([])
      signal.throwIfAborted()
      await expect(getRemoteDrift(repoPath, 'HEAD', 'missing-ref')).resolves.toBeNull()
      signal.throwIfAborted()
      await expect(getRecentDriftSubjects(repoPath, 'HEAD', 'missing-ref', 5)).resolves.toEqual([])
    })()
    await pendingSubject
  })
})
