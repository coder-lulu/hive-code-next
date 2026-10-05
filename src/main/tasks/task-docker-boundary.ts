import { lstatSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { runProcess, type ProcessResult } from '../../shared/child-process/run-process'
import { RetryableProcessExitProof } from '../../shared/child-process/retryable-process-exit-proof'
import { taskDockerConfiguration, type TaskDockerRecord } from './task-docker-configuration'
import {
  taskDockerContainer,
  taskDockerCleanupContainer,
  taskDockerDaemon,
  taskDockerImage,
  taskDockerNeverStarted,
  taskDockerVerdict
} from './task-docker-inspection'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskDirectoryIdentity } from './task-managed-copy'
import {
  TaskDockerIdentitySchema,
  taskDockerIdentityFor,
  type TaskDockerIdentity
} from './task-docker-identity'

export type TaskDockerPrepared = {
  containerId: string
  launch: {
    command: string
    args: string[]
    cwd: string
    environmentMode: 'replace'
    env: Record<string, string>
  }
  assertCurrent: () => void
}

export function createTaskDockerBoundary(options: {
  dockerPath: string
  endpoint: string
  imageId: string
  record: TaskDockerRecord
  assertCurrent: () => void
  persistIdentity?: (identity: TaskDockerIdentity) => Promise<void>
  recoveryIdentity?: TaskDockerIdentity
  run?: typeof runProcess
}) {
  const config = taskDockerConfiguration(options)
  const recovery =
    options.recoveryIdentity === undefined
      ? null
      : TaskDockerIdentitySchema.parse(options.recoveryIdentity)
  if (
    (!recovery && typeof options.persistIdentity !== 'function') ||
    (recovery &&
      (options.persistIdentity !== undefined ||
        !isDeepStrictEqual(
          recovery,
          taskDockerIdentityFor(config, recovery.daemon, recovery.containerId)
        )))
  ) {
    refuseTaskExecution('INVALID_REQUEST')
  }
  const run = options.run ?? runProcess
  const exitProof = new RetryableProcessExitProof()
  let containerId = recovery?.containerId ?? null
  let imageEnv: Record<string, string> | null = null
  let daemon: ReturnType<typeof taskDockerDaemon> | null = recovery?.daemon ?? null
  let createAttempted = false
  let stopping = recovery !== null
  let pendingCheckpointed = false
  let preparing: Promise<TaskDockerPrepared> | null = null

  function assertWorkspace(): void {
    assertTaskDirectoryIdentity(config.workspace.executionPath, config.workspace.directoryIdentity)
  }
  function assertCurrent(): void {
    if (stopping) {
      refuseTaskExecution('FORBIDDEN')
    }
    options.assertCurrent()
    assertWorkspace()
    assertEmptyCliConfig()
  }
  function assertEmptyCliConfig(): void {
    try {
      lstatSync(config.configDirectory)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return
      }
      return refuseTaskExecution('FORBIDDEN')
    }
    refuseTaskExecution('FORBIDDEN')
  }
  async function invoke(args: string[], current: boolean): Promise<ProcessResult> {
    function assertInvocation(): void {
      if (current) {
        assertCurrent()
      } else if (!statSync(config.dockerPath).isFile()) {
        refuseTaskExecution('FORBIDDEN')
      }
    }
    assertInvocation()
    try {
      return await run({
        program: config.dockerPath,
        args: [...(current ? config.prefix : config.cleanupPrefix), ...args],
        cwd: current ? config.workspace.executionPath : dirname(config.dockerPath),
        env: { ...config.cliEnv },
        timeoutMs: 15000,
        maxOutputBytes: 262144
      })
    } finally {
      assertInvocation()
    }
  }
  async function requireDaemon(current: boolean): Promise<void> {
    if (!current && !daemon) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    const observed = taskDockerDaemon(
      await invoke(
        [
          'info',
          '--format',
          '{"ID":{{json .ID}},"OSType":{{json .OSType}},"Architecture":{{json .Architecture}},"ServerVersion":{{json .ServerVersion}}}'
        ],
        current
      )
    )
    if (
      daemon &&
      (current
        ? !isDeepStrictEqual(daemon, observed)
        : daemon.ID !== observed.ID ||
          daemon.OSType !== observed.OSType ||
          daemon.Architecture !== observed.Architecture)
    ) {
      refuseTaskExecution('FORBIDDEN')
    }
    daemon ??= observed
  }
  async function requireImage(current: boolean): Promise<Record<string, string>> {
    if (!imageEnv) {
      await requireDaemon(current)
      imageEnv = taskDockerImage(
        await invoke(['image', 'inspect', config.imageId], current),
        config.imageId
      )
      await requireDaemon(current)
    }
    return imageEnv
  }
  async function inspectOwned(current: boolean) {
    const env = current ? await requireImage(true) : null
    await requireDaemon(current)
    const target = containerId ?? config.name
    const reply = await invoke(['container', 'inspect', target], current)
    await requireDaemon(current)
    const missing = [
      `Error: No such object: ${target}`,
      `Error response from daemon: No such container: ${target}`,
      `Error: No such container: ${target}`
    ].includes(reply.stderr.trim())
    if (
      reply.code === 1 &&
      !reply.signal &&
      !reply.timedOut &&
      !reply.outputTruncated &&
      ['', '[]'].includes(reply.stdout.trim()) &&
      missing
    ) {
      return null
    }
    const found = !current
      ? taskDockerCleanupContainer(reply, config, containerId)
      : env
        ? taskDockerContainer(reply, config, env, containerId)
        : refuseTaskExecution('OUTCOME_UNKNOWN')
    containerId = found.Id
    return found
  }
  async function checkpoint(id: string | null): Promise<void> {
    assertCurrent()
    if (!daemon || !options.persistIdentity) {
      refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    await options.persistIdentity(taskDockerIdentityFor(config, daemon, id))
    assertCurrent()
    await requireDaemon(true)
    assertCurrent()
  }
  async function prepareContainer(): Promise<TaskDockerPrepared> {
    assertCurrent()
    if (!pendingCheckpointed) {
      await requireImage(true)
      await checkpoint(null)
      pendingCheckpointed = true
    }
    let found = await inspectOwned(true)
    if (!found) {
      if (createAttempted || containerId) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      createAttempted = true
      assertCurrent()
      await requireDaemon(true)
      let replyId: string | null = null
      try {
        const reply = await invoke(config.createArgs, true)
        if (
          reply.code === 0 &&
          !reply.signal &&
          !reply.timedOut &&
          !reply.outputTruncated &&
          /^[0-9a-f]{64}$/.test(reply.stdout.trim())
        ) {
          replyId = reply.stdout.trim()
        }
      } catch {
        // An ambiguous create can only be recovered through the exact original name.
      }
      await requireDaemon(true)
      found = await inspectOwned(true)
      if (!found) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
      if (replyId && replyId !== found.Id) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    if (!taskDockerNeverStarted(found)) {
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
    await checkpoint(found.Id)
    assertCurrent()
    return {
      containerId: found.Id,
      assertCurrent,
      launch: {
        command: config.dockerPath,
        args: [...config.prefix, 'start', '--attach', '--interactive', found.Id],
        // The Docker client's cwd is not the guest's /workspace. Keeping the
        // client outside it also prevents a Windows cwd handle locking the copy.
        cwd: dirname(config.dockerPath),
        environmentMode: 'replace',
        env: { ...config.cliEnv }
      }
    }
  }
  return {
    prepare(): Promise<TaskDockerPrepared> {
      if (preparing) {
        return preparing
      }
      const attempt = prepareContainer()
      preparing = attempt
      void attempt.then(
        () => {
          if (preparing === attempt) {
            preparing = null
          }
        },
        () => {
          if (preparing === attempt) {
            preparing = null
          }
        }
      )
      return attempt
    },
    async inspect(): Promise<'live' | 'unverifiable' | 'exited'> {
      try {
        const found = await inspectOwned(!stopping)
        return found ? taskDockerVerdict(found) : 'unverifiable'
      } catch {
        return 'unverifiable'
      }
    },
    stop(): Promise<boolean> {
      stopping = true
      return exitProof.run(async () => {
        try {
          const found = await inspectOwned(false)
          if (!found || taskDockerNeverStarted(found)) {
            return false
          }
          await requireDaemon(false)
          try {
            await invoke(['kill', '--signal=KILL', found.Id], false)
          } catch {
            /* CLI exit is not writer exit. */
          }
          await requireDaemon(false)
          const after = await inspectOwned(false)
          return after !== null && taskDockerVerdict(after) === 'exited'
        } catch {
          return false
        }
      })
    }
  }
}
