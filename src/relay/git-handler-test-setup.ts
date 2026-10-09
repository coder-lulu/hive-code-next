/**
 * Shared test utilities for git-handler tests.
 *
 * Why: oxlint max-lines (300) requires splitting large test suites.
 * This module exports the mock dispatcher factory and git helpers
 * so multiple test files can reuse them without duplication.
 */
import { vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { runProcess } from '../shared/child-process/run-process'
import type { RelayDispatcher } from './dispatcher'

const TEST_GIT_USER_EMAIL = 'test@test.com'
const TEST_GIT_USER_NAME = 'Test'

// Why: declare an explicit type so the inferred return type of
// createMockDispatcher doesn't transitively reference `@vitest/spy`'s
// internal `Procedure` type (from `vi.fn(...)`). Without this annotation,
// TS2883 fires under `pnpm run tc:node` because the generated .d.ts would
// need to name a type that isn't portably resolvable from this module.
export type MockDispatcher = {
  onRequest: (
    method: string,
    handler: (
      params: Record<string, unknown>,
      context: { isStale: () => boolean; signal?: AbortSignal }
    ) => Promise<unknown>
  ) => void
  onNotification: (method: string, handler: (params: Record<string, unknown>) => void) => void
  notify: (method: string, params?: Record<string, unknown>) => void
  _requestHandlers: Map<
    string,
    (
      params: Record<string, unknown>,
      context: { isStale: () => boolean; signal?: AbortSignal }
    ) => Promise<unknown>
  >
  callRequest(
    method: string,
    params?: Record<string, unknown>,
    context?: { isStale: () => boolean; signal?: AbortSignal }
  ): Promise<unknown>
}

export function createMockDispatcher(): MockDispatcher {
  const requestHandlers = new Map<
    string,
    (
      params: Record<string, unknown>,
      context: { isStale: () => boolean; signal?: AbortSignal }
    ) => Promise<unknown>
  >()

  return {
    onRequest: vi.fn(
      (
        method: string,
        handler: (
          params: Record<string, unknown>,
          context: { isStale: () => boolean; signal?: AbortSignal }
        ) => Promise<unknown>
      ) => {
        requestHandlers.set(method, handler)
      }
    ),
    onNotification: vi.fn(),
    notify: vi.fn(),
    _requestHandlers: requestHandlers,
    async callRequest(
      method: string,
      params: Record<string, unknown> = {},
      context: { isStale: () => boolean; signal?: AbortSignal } = { isStale: () => false }
    ) {
      const handler = requestHandlers.get(method)
      if (!handler) {
        throw new Error(`No handler for ${method}`)
      }
      return handler(params, context)
    }
  }
}

export function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', TEST_GIT_USER_EMAIL], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', TEST_GIT_USER_NAME], { cwd: dir, stdio: 'pipe' })
}

export function gitCommit(dir: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' })
  // Why: `git submodule add` creates a checkout that does not inherit the
  // source repo's local identity config, and CI may have no global identity.
  execFileSync(
    'git',
    [
      '-c',
      `user.email=${TEST_GIT_USER_EMAIL}`,
      '-c',
      `user.name=${TEST_GIT_USER_NAME}`,
      'commit',
      '-m',
      message,
      '--allow-empty'
    ],
    { cwd: dir, stdio: 'pipe' }
  )
}

export function createGitTestRunner() {
  let signal: AbortSignal | undefined
  let timeoutMs: number | null | undefined
  const pending = new Set<Promise<string>>()
  const terminated: Promise<void>[] = []
  return {
    useSignal(next: AbortSignal, commandTimeout?: number | null): void {
      signal = next
      timeoutMs = commandTimeout
    },
    git(
      cwd: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv; input?: string } = {}
    ): Promise<string> {
      const commandSignal = signal
      const operation = (async () => {
        commandSignal?.throwIfAborted()
        const closed = Promise.withResolvers<void>()
        terminated.push(closed.promise)
        const result = await runProcess({
          program: 'git',
          args,
          cwd,
          ...options,
          timeoutMs,
          signal: commandSignal,
          terminationBarrier: true,
          onChildTerminated: closed.resolve
        })
        commandSignal?.throwIfAborted()
        if (result.code !== 0 || result.signal !== null || result.timedOut) {
          throw Object.assign(
            new Error(`Git test command failed: ${args.join(' ')}\n${result.stderr}`),
            {
              code: result.code,
              signal: result.signal,
              stdout: result.stdout,
              stderr: result.stderr
            }
          )
        }
        return result.stdout
      })()
      pending.add(operation)
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation)
      )
      return operation
    },
    async init(cwd: string): Promise<void> {
      await this.git(cwd, ['init'])
      await this.git(cwd, ['config', 'user.email', TEST_GIT_USER_EMAIL])
      await this.git(cwd, ['config', 'user.name', TEST_GIT_USER_NAME])
    },
    async commit(cwd: string, message: string): Promise<void> {
      await this.git(cwd, ['add', '.'])
      await this.git(cwd, [
        '-c',
        `user.email=${TEST_GIT_USER_EMAIL}`,
        '-c',
        `user.name=${TEST_GIT_USER_NAME}`,
        'commit',
        '-m',
        message,
        '--allow-empty'
      ])
    },
    async settle(): Promise<void> {
      await Promise.allSettled(pending)
      await Promise.all(terminated.splice(0))
    }
  }
}

export type { RelayDispatcher }
