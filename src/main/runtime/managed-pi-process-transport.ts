import { spawnProcess, type ChildProcessHandle } from '../../shared/child-process/run-process'
import { win32 } from 'node:path'
import {
  signalProcessTree,
  forceTerminateProcessTree
} from '../../shared/child-process/process-tree-termination'
import { managedPiObject, managedPiScope } from '../../shared/managed-pi-process-protocol'
import { createManagedPiEnvironment } from './managed-pi-environment'

export function managedPiDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hive_agent_outcome_unknown')), timeoutMs)
    void promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
type Frame = Record<string, unknown>
const fields: Record<string, readonly string[]> = {
  ready: ['challenge', 'runtimeFence', 'pid', 'parentPid', 'startedAtMs', 'spawnToken', 'identity'],
  output: ['generationId', 'event'],
  idle: ['generationId', 'outcome'],
  'inference.open': ['generationId'],
  'inference.ack': ['generationId', 'sequence']
}
export class ManagedPiProcessTransport {
  readonly child: ChildProcessHandle
  readonly failure: Promise<never>
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  private failureReason: Error | undefined
  private stopping: Promise<void> | undefined
  private readonly listeners = new Set<(frame: Frame) => void>()
  private readonly failureListeners = new Set<() => void>()
  private readonly waiters = new Map<
    string,
    { matches: (frame: Frame) => boolean; resolve: (frame: Frame) => void }
  >()
  private rejectFailure!: (error: Error) => void
  constructor(options: {
    files: { node: string; runner: string }
    home: string
    epoch: string
    sessionId: string
    spawnToken: string
  }) {
    this.epoch = options.epoch
    this.sessionId = options.sessionId
    this.failure = new Promise((_, reject) => {
      this.rejectFailure = reject
    })
    void this.failure.catch(() => {})
    this.child = spawnProcess({
      program: options.files.node,
      args: ['-e', 'require(process.argv[1]).startManagedTextProcess()', options.files.runner],
      cwd: process.platform === 'win32' ? win32.toNamespacedPath(options.home) : options.home,
      env: {
        ...createManagedPiEnvironment(process.env, options.home),
        ORCA_AGENT_SESSION_SPAWN_TOKEN: options.spawnToken
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    })
    this.exited = new Promise((resolve) => {
      this.child.once('close', (code, signal) => {
        resolve({ code, signal })
        this.fail()
      })
    })
    this.child.on('error', () => this.fail())
    for (const stream of [this.child.stdin, this.child.stdout, this.child.stderr]) {
      stream?.on('error', () => this.fail())
    }
    this.child.stdout?.on('data', () => this.fail())
    this.child.stderr?.on('data', () => this.fail())
    this.child.on('message', (raw) => {
      try {
        const kind = (raw as Frame | null)?.type
        if (typeof kind !== 'string' || !Object.hasOwn(fields, kind)) {
          throw new Error('invalid frame')
        }
        const frame = managedPiObject(raw, ['type', 'epoch', 'sessionId', ...fields[kind]])
        managedPiScope(frame, this.epoch, this.sessionId)
        const waiter = this.waiters.get(kind)
        if (waiter) {
          if (!waiter.matches(frame)) {
            throw new Error('unexpected response')
          }
          this.waiters.delete(kind)
          waiter.resolve(frame)
        } else if (kind === 'ready' || kind === 'inference.ack') {
          throw new Error('unsolicited response')
        }
        if (!waiter && this.listeners.size === 0) {
          throw new Error('unowned frame')
        }
        for (const listener of this.listeners) {
          listener(frame)
        }
      } catch {
        this.fail()
      }
    })
    this.child.on('disconnect', () => this.fail())
  }
  readonly epoch: string
  readonly sessionId: string
  fail(): void {
    if (!this.failureReason) {
      this.failureReason = new Error('hive_agent_outcome_unknown')
      this.rejectFailure(this.failureReason)
      for (const listener of this.failureListeners) {
        listener()
      }
      void this.stop().catch(() => {})
    }
  }
  assertCurrent(): void {
    if (
      this.failureReason ||
      !this.child.connected ||
      this.child.exitCode !== null ||
      this.child.signalCode !== null
    ) {
      throw new Error('hive_agent_outcome_unknown')
    }
  }
  listen(listener: (frame: Frame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  wait<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (complete: () => void) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', failed)
        this.failureListeners.delete(failed)
        complete()
      }
      const failed = () => settle(() => reject(new Error('hive_agent_outcome_unknown')))
      const timer = setTimeout(failed, timeoutMs)
      this.failureListeners.add(failed)
      signal?.addEventListener('abort', failed, { once: true })
      void promise.then((value) => settle(() => resolve(value)), failed)
      try {
        this.assertCurrent()
        if (signal?.aborted) {
          failed()
        }
      } catch {
        failed()
      }
    })
  }
  send(frame: Frame): Promise<void> {
    this.assertCurrent()
    return new Promise((resolve, reject) => {
      this.child.send?.({ epoch: this.epoch, sessionId: this.sessionId, ...frame }, (error) => {
        if (error) {
          this.fail()
          reject(new Error('hive_agent_outcome_unknown'))
        } else {
          resolve()
        }
      })
    })
  }
  async exchange(
    frame: Frame,
    kind: string,
    matches: (value: Frame) => boolean,
    timeoutMs: number
  ): Promise<Frame> {
    this.assertCurrent()
    if (this.waiters.has(kind)) {
      throw new Error('hive_agent_outcome_unknown')
    }
    const response = new Promise<Frame>((resolve) => this.waiters.set(kind, { matches, resolve }))
    try {
      await this.wait(this.send(frame), timeoutMs)
      return await this.wait(response, timeoutMs)
    } finally {
      this.waiters.delete(kind)
    }
  }
  stop(): Promise<void> {
    this.stopping ??= this.stopChild()
    return this.stopping
  }
  private async stopChild(): Promise<void> {
    if (this.child.connected) {
      try {
        await managedPiDeadline(this.send({ type: 'shutdown' }), 500)
      } catch {
        /* Stop still uses the owned handle. */
      }
    }
    try {
      await managedPiDeadline(this.exited, 500)
      return
    } catch {
      /* Escalate the owned child. */
    }
    await signalProcessTree(this.child).catch(() => false)
    try {
      await managedPiDeadline(this.exited, 500)
      return
    } catch {
      /* Verify force termination. */
    }
    await forceTerminateProcessTree(this.child).catch(() => false)
    await managedPiDeadline(this.exited, 3000)
  }
}
