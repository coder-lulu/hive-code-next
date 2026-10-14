import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'
import { gitFastForward, gitPull } from './remote'
import type { GitExecOptions } from './command-runner/git-exec-options'

const { git } = vi.hoisted(() => ({ git: vi.fn<(args: string[], options?: GitExecOptions) => Promise<{ stdout: string; stderr: string }>>() }))
vi.mock('./runner', () => ({ gitExecFileAsync: git }))
const target = { remoteName: 'origin', branchName: 'main' }
let sequence = 0
beforeEach(() => { git.mockReset() })

describe('current host Git pull cancellation', () => {
  it.each([gitPull, gitFastForward])('does not enter Git after a queued request is cancelled', async (pull) => {
    const path = `/pull-cancellation-${sequence++}`
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const controller = new AbortController()
    const holder = runWithGitWorktreeOperationLock(path, undefined, async () => {
      entered.resolve()
      await release.promise
    })
    await entered.promise
    const request = pull(path, target, { signal: controller.signal })
    const outcome = expect(request).rejects.toThrow()
    controller.abort()
    try {
      await outcome
      expect(git).not.toHaveBeenCalled()
    } finally {
      release.resolve()
      await holder
    }
  })

  it.each([gitPull, gitFastForward])('passes the request signal into running Git', async (pull) => {
    const controller = new AbortController()
    const entered = Promise.withResolvers<AbortSignal | undefined>()
    git.mockImplementation(async (args, options) => {
      if (args[0] !== 'pull') {
        return { stdout: '', stderr: '' }
      }
      entered.resolve(options?.signal)
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
      })
    })
    const request = pull(`/pull-cancellation-${sequence++}`, target, { signal: controller.signal })
    const outcome = expect(request).rejects.toThrow(/abort/i)
    expect(await entered.promise).toBe(controller.signal)
    controller.abort()
    await outcome
    expect(git.mock.calls.filter(([args]) => args[0] === 'pull')).toHaveLength(1)
  })

  it('cancels upstream discovery before starting the pull', async () => {
    const controller = new AbortController()
    const entered = Promise.withResolvers<AbortSignal | undefined>()
    git.mockImplementation(async (_args, options) => {
      options?.signal?.throwIfAborted()
      entered.resolve(options?.signal)
      return await new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true })
      })
    })
    const request = gitPull(`/pull-cancellation-${sequence++}`, undefined, { signal: controller.signal })
    const outcome = expect(request).rejects.toThrow(/abort/i)
    expect(await entered.promise).toBe(controller.signal)
    controller.abort()
    await outcome
    expect(git.mock.calls.some(([args]) => args[0] === 'pull')).toBe(false)
  })

  it('does not retry a divergent pull after cancellation', async () => {
    const controller = new AbortController()
    git.mockImplementation(async (args) => {
      if (args[0] === 'pull') {
        controller.abort()
        throw new Error('fatal: Need to specify how to reconcile divergent branches.')
      }
      return { stdout: '', stderr: '' }
    })
    await expect(gitPull(`/pull-cancellation-${sequence++}`, target, { signal: controller.signal })).rejects.toThrow(/abort/i)
    expect(git.mock.calls.filter(([args]) => args[0] === 'pull')).toHaveLength(1)
  })
})
