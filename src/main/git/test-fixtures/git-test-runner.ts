import { execFileSync } from 'node:child_process'
import { runProcess } from '@orca/process-host'

const TEST_GIT_USER_EMAIL = 'test@test.com'
const TEST_GIT_USER_NAME = 'Test'

export function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe', windowsHide: true })
  execFileSync('git', ['config', 'user.email', TEST_GIT_USER_EMAIL], { cwd: dir, stdio: 'pipe', windowsHide: true })
  execFileSync('git', ['config', 'user.name', TEST_GIT_USER_NAME], { cwd: dir, stdio: 'pipe', windowsHide: true })
}

export function gitCommit(dir: string, message: string): void {
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe', windowsHide: true })
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
    { cwd: dir, stdio: 'pipe', windowsHide: true }
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
