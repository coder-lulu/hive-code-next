import type * as childProcess from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runProcess } from '../shared/child-process/run-process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { RelayContext } from './context'
import { GitHandler } from './git-handler'
import {
  createMockDispatcher,
  type MockDispatcher,
  type RelayDispatcher
} from './git-handler-test-setup'

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

describe('GitHandler pull reconciliation', () => {
  let dispatcher: MockDispatcher
  let handler: GitHandler
  let consumerDir: string
  let operationSignal: AbortSignal
  let pendingSetup: Promise<void> | undefined
  let pendingSubject: Promise<void> | undefined
  const childTerminations: Promise<void>[] = []
  let tmpDir: string
  let gitEnv: NodeJS.ProcessEnv
  let previousGitConfigGlobal: string | undefined
  let previousGitConfigNosystem: string | undefined

  beforeEach(async ({ signal, task }) => {
    operationSignal = signal
    tmpDir = mkdtempSync(path.join(tmpdir(), 'relay-git-pull-reconciliation-'))
    const globalGitConfigPath = path.join(tmpDir, 'global-gitconfig')
    writeFileSync(globalGitConfigPath, '')
    previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL
    previousGitConfigNosystem = process.env.GIT_CONFIG_NOSYSTEM
    process.env.GIT_CONFIG_GLOBAL = globalGitConfigPath
    process.env.GIT_CONFIG_NOSYSTEM = '1'
    gitEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalGitConfigPath,
      GIT_CONFIG_NOSYSTEM: '1'
    }
    dispatcher = createMockDispatcher()
    const ctx = new RelayContext()
    handler = new GitHandler(dispatcher as unknown as RelayDispatcher, ctx)
    pendingSetup = (async () => {
      consumerDir = await createDivergentFixture()
      if (
        task.name === 'preserves configured fast-forward-only pull semantics on divergent branches'
      ) {
        await execGit(consumerDir, ['config', 'pull.ff', 'only'])
      } else if (task.name === 'preserves configured rebase pull semantics') {
        await execGit(consumerDir, ['config', 'pull.rebase', 'true'])
      }
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
    handler.dispose()
    restoreGitEnv('GIT_CONFIG_GLOBAL', previousGitConfigGlobal)
    restoreGitEnv('GIT_CONFIG_NOSYSTEM', previousGitConfigNosystem)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function execGit(cwd: string, args: string[]): Promise<string> {
    operationSignal.throwIfAborted()
    const terminated = Promise.withResolvers<void>()
    childTerminations.push(terminated.promise)
    const result = await runProcess({
      program: 'git',
      args,
      cwd,
      env: gitEnv,
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

  async function configureIdentity(cwd: string): Promise<void> {
    await execGit(cwd, ['config', 'user.email', 'test@test.com'])
    await execGit(cwd, ['config', 'user.name', 'Test'])
  }

  async function commitAll(cwd: string, message: string): Promise<void> {
    await execGit(cwd, ['add', '.'])
    await execGit(cwd, ['commit', '-m', message])
  }

  async function createDivergentFixture(): Promise<string> {
    const bareDir = path.join(tmpDir, 'origin.git')
    const consumerDir = path.join(tmpDir, 'consumer')
    const producerDir = path.join(tmpDir, 'producer')

    await execGit(tmpDir, ['init', '--bare', bareDir])
    await execGit(tmpDir, ['clone', bareDir, consumerDir])
    await configureIdentity(consumerDir)
    writeFileSync(path.join(consumerDir, 'base.txt'), 'base\n')
    await commitAll(consumerDir, 'initial')
    await execGit(consumerDir, ['push', '--set-upstream', 'origin', 'HEAD'])

    await execGit(tmpDir, ['clone', bareDir, producerDir])
    await configureIdentity(producerDir)
    writeFileSync(path.join(producerDir, 'remote.txt'), 'remote\n')
    await commitAll(producerDir, 'remote')
    await execGit(producerDir, ['push'])

    writeFileSync(path.join(consumerDir, 'local.txt'), 'local\n')
    await commitAll(consumerDir, 'local')

    return consumerDir
  }

  it('falls back to a merge when divergent branches have no configured strategy', async ({
    signal
  }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      signal.throwIfAborted()

      await expect(
        dispatcher.callRequest(
          'git.pull',
          { worktreePath: consumerDir },
          { signal, isStale: () => signal.aborted }
        )
      ).resolves.not.toThrow()

      // Merge reconciliation yields a two-parent commit and both sides' files.
      const parentRefs = (await execGit(consumerDir, ['log', '-1', '--pretty=%P']))
        .trim()
        .split(/\s+/)
      expect(parentRefs).toHaveLength(2)
      expect(existsSync(path.join(consumerDir, 'remote.txt'))).toBe(true)
      expect(existsSync(path.join(consumerDir, 'local.txt'))).toBe(true)
      expect(await execGit(consumerDir, ['status', '--short'])).toBe('')
    })()
    await pendingSubject
  }, 15_000)

  it('preserves configured fast-forward-only pull semantics on divergent branches', async ({
    signal
  }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      signal.throwIfAborted()

      // Why: an explicit ff-only policy must still fail on divergence rather than
      // getting silently reconciled by the merge fallback.
      await expect(
        dispatcher.callRequest(
          'git.pull',
          { worktreePath: consumerDir },
          { signal, isStale: () => signal.aborted }
        )
      ).rejects.toThrow()

      const parentRefs = (await execGit(consumerDir, ['log', '-1', '--pretty=%P']))
        .trim()
        .split(/\s+/)
      expect(parentRefs).toHaveLength(1)
      expect(await execGit(consumerDir, ['status', '--short'])).toBe('')
    })()
    await pendingSubject
  }, 15_000)

  it('preserves configured rebase pull semantics', async ({ signal }) => {
    operationSignal = signal
    pendingSubject = (async () => {
      signal.throwIfAborted()

      await expect(
        dispatcher.callRequest(
          'git.pull',
          { worktreePath: consumerDir },
          { signal, isStale: () => signal.aborted }
        )
      ).resolves.not.toThrow()

      const parentRefs = (await execGit(consumerDir, ['log', '-1', '--pretty=%P']))
        .trim()
        .split(/\s+/)
      expect(parentRefs).toHaveLength(1)
      expect(existsSync(path.join(consumerDir, 'remote.txt'))).toBe(true)
      expect(await execGit(consumerDir, ['status', '--short'])).toBe('')
    })()
    await pendingSubject
  }, 15_000)
})

function restoreGitEnv(
  name: 'GIT_CONFIG_GLOBAL' | 'GIT_CONFIG_NOSYSTEM',
  value: string | undefined
): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}
