import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { runWithGitWorktreeOperationLock } from '../shared/git-worktree-operation-lock'
import { createGitHandlerRelay, type GitSpyTarget } from './git-handler-test-harness'

let sequence = 0
function worktreePath(): string {
  return join(tmpdir(), `relay-pull-cancellation-${process.pid}-${sequence++}`)
}

function fixture() {
  const { dispatcher, handler } = createGitHandlerRelay()
  // SAFETY: this shared target describes GitHandler's existing private Git method.
  const git = vi.spyOn(handler as unknown as GitSpyTarget, 'git')
  return { dispatcher, handler, git }
}

const PUSH_TARGET = { remoteName: 'origin', branchName: 'main' }
const abortError = () => new Error('The request was aborted.')

describe('relay pull cancellation', () => {
  it.each(['git.pull', 'git.fastForward'])(
    'cancels queued %s without entering Git',
    async (method) => {
      const { dispatcher, handler, git } = fixture()
      git.mockResolvedValue({ stdout: '', stderr: '' })
      const controller = new AbortController()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const path = worktreePath()
      const holder = runWithGitWorktreeOperationLock(path, undefined, async () => {
        entered.resolve()
        await release.promise
      })
      await entered.promise
      const request = dispatcher.callRequest(
        method,
        { worktreePath: path, pushTarget: PUSH_TARGET },
        { signal: controller.signal, isStale: () => controller.signal.aborted }
      )
      const outcome = request.then(
        (value) => ({ succeeded: true, value }),
        (error: unknown) => ({ succeeded: false, error })
      )
      try {
        controller.abort()
        expect(await outcome).toMatchObject({ succeeded: false, error: expect.any(Error) })
        expect(git).not.toHaveBeenCalled()
      } finally {
        controller.abort()
        release.resolve()
        await Promise.allSettled([holder, outcome])
        handler.dispose()
        vi.restoreAllMocks()
      }
    }
  )

  it.each(['git.pull', 'git.fastForward'])(
    'cancels already running %s through the request signal',
    async (method) => {
      const { dispatcher, handler, git } = fixture()
      const controller = new AbortController()
      const entered = Promise.withResolvers<AbortSignal | undefined>()
      const stopped = Promise.withResolvers<{ stdout: string; stderr: string }>()
      git.mockImplementation(async (args, _cwd, options) => {
        if (args[0] !== 'pull') {
          return { stdout: '', stderr: '' }
        }
        entered.resolve(options?.signal)
        const onAbort = () => stopped.reject(abortError())
        options?.signal?.addEventListener('abort', onAbort, { once: true })
        try {
          return await stopped.promise
        } finally {
          options?.signal?.removeEventListener('abort', onAbort)
        }
      })
      const request = dispatcher.callRequest(
        method,
        { worktreePath: worktreePath(), pushTarget: PUSH_TARGET },
        { signal: controller.signal, isStale: () => controller.signal.aborted }
      )
      const outcome = request.then(
        (value) => ({ succeeded: true, value }),
        (error: unknown) => ({ succeeded: false, error })
      )
      try {
        const signal = await entered.promise
        controller.abort()
        expect(signal).toBe(controller.signal)
        expect(await outcome).toMatchObject({ succeeded: false, error: expect.any(Error) })
        expect(git.mock.calls.filter(([args]) => args[0] === 'pull')).toHaveLength(1)
      } finally {
        controller.abort()
        stopped.reject(abortError())
        await outcome
        handler.dispose()
        vi.restoreAllMocks()
      }
    }
  )

  it('cancels upstream discovery before starting the pull', async () => {
    const { dispatcher, handler, git } = fixture()
    const controller = new AbortController()
    const entered = Promise.withResolvers<AbortSignal | undefined>()
    const stopped = Promise.withResolvers<{ stdout: string; stderr: string }>()
    git.mockImplementation(async (_args, _cwd, options) => {
      options?.signal?.throwIfAborted()
      entered.resolve(options?.signal)
      const onAbort = () => stopped.reject(abortError())
      options?.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        return await stopped.promise
      } finally {
        options?.signal?.removeEventListener('abort', onAbort)
      }
    })
    const request = dispatcher.callRequest(
      'git.pull',
      { worktreePath: worktreePath() },
      { signal: controller.signal, isStale: () => controller.signal.aborted }
    )
    const outcome = request.then(
      (value) => ({ succeeded: true, value }),
      (error: unknown) => ({ succeeded: false, error })
    )
    try {
      const signal = await entered.promise
      controller.abort()
      expect(signal).toBe(controller.signal)
      expect(await outcome).toMatchObject({ succeeded: false, error: expect.any(Error) })
      expect(git.mock.calls.some(([args]) => args[0] === 'pull')).toBe(false)
    } finally {
      controller.abort()
      stopped.reject(abortError())
      await outcome
      handler.dispose()
      vi.restoreAllMocks()
    }
  })

  it('does not replay a divergent pull after cancellation', async () => {
    const { dispatcher, handler, git } = fixture()
    const controller = new AbortController()
    const pulls: string[][] = []
    git.mockImplementation(async (args) => {
      if (args[0] === 'pull') {
        pulls.push(args)
        if (pulls.length === 1) {
          controller.abort()
          throw new Error('fatal: Need to specify how to reconcile divergent branches.')
        }
      }
      return { stdout: '', stderr: '' }
    })
    try {
      await expect(
        dispatcher.callRequest(
          'git.pull',
          { worktreePath: worktreePath(), pushTarget: PUSH_TARGET },
          { signal: controller.signal, isStale: () => controller.signal.aborted }
        )
      ).rejects.toThrow(/abort/i)
      expect(pulls).toHaveLength(1)
    } finally {
      controller.abort()
      handler.dispose()
      vi.restoreAllMocks()
    }
  })
})
