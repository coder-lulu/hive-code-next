import { realpathSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { runProcess } from '../../shared/child-process/run-process'
import type { TaskExecutionStart } from '../../shared/task-execution/task-execution-command'
import { TaskEpoch, TaskOpaqueRef } from '../../shared/task-execution/task-execution-primitives'
import { taskDockerCliConfiguration } from './task-docker-configuration'
import { taskDockerDaemon, taskDockerImage } from './task-docker-inspection'
import type { TaskDockerDaemonIdentity } from './task-docker-identity'
import type { TaskDockerRuntimeConfiguration } from './task-docker-runtime-configuration'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'

export const TASK_DOCKER_ENFORCEMENT_POLICY = 'docker-local-linux'
export const TASK_DOCKER_ENFORCEMENT_REVISION = '1'
const Owner = z.strictObject({
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionAccountRef: TaskOpaqueRef
})
export type TaskDockerEnforcementOwner = z.infer<typeof Owner>
export type TaskDockerEnforcement = {
  owner: TaskDockerEnforcementOwner
  policy: Extract<TaskExecutionStart['executionPolicy'], { trustMode: 'enforced_autonomous' }>
  daemon: TaskDockerDaemonIdentity
  assertCurrent(): void
}

export function isTaskDockerEnforcementPolicy(policy: TaskExecutionStart['executionPolicy']) {
  return (
    policy.trustMode === 'enforced_autonomous' &&
    policy.executionPolicyRef === TASK_DOCKER_ENFORCEMENT_POLICY &&
    policy.executionPolicyRevision === TASK_DOCKER_ENFORCEMENT_REVISION &&
    /^docker-enforcement:[a-f0-9]{64}$/.test(policy.enforcementEvidenceRef)
  )
}

export function assertTaskDockerEnforcementCommand(
  command: TaskExecutionStart,
  proof: TaskDockerEnforcement
) {
  assertTaskAuthorizationCurrent(() => proof.assertCurrent())
  if (
    command.ownerScope.kind !== 'personalTenant' ||
    !isDeepStrictEqual(proof.owner, {
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionAccountRef: command.executionAccountRef
    }) ||
    command.policyRevision !==
      `${TASK_DOCKER_ENFORCEMENT_POLICY}:${TASK_DOCKER_ENFORCEMENT_REVISION}` ||
    !isDeepStrictEqual(command.executionPolicy, proof.policy)
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
}

function executableIdentity(path: string) {
  const canonicalPath = realpathSync(path)
  const stats = statSync(canonicalPath, { bigint: true })
  if (!stats.isFile()) {
    return refuseTaskExecution('FORBIDDEN')
  }
  return {
    canonicalPath,
    dev: String(stats.dev),
    ino: String(stats.ino),
    size: String(stats.size),
    mtimeNs: String(stats.mtimeNs),
    ctimeNs: String(stats.ctimeNs)
  }
}

/** Installed host configuration selects a boundary; actual Docker observations prove availability. */
export async function probeTaskDockerEnforcement(options: {
  configuration(): TaskDockerRuntimeConfiguration
  owner: TaskDockerEnforcementOwner
  assertCurrent(): void
  run?: typeof runProcess
}): Promise<TaskDockerEnforcement> {
  try {
    const owner = Owner.parse(options.owner)
    const configuration = { ...options.configuration() }
    const cli = taskDockerCliConfiguration(configuration)
    const executable = executableIdentity(configuration.dockerPath)
    const assertCurrent = () => {
      assertTaskAuthorizationCurrent(() => options.assertCurrent())
      if (
        !isDeepStrictEqual(options.configuration(), configuration) ||
        !isDeepStrictEqual(executableIdentity(configuration.dockerPath), executable)
      ) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    const invoke = async (args: string[]) => {
      assertCurrent()
      try {
        return await (options.run ?? runProcess)({
          program: configuration.dockerPath,
          args: [...cli.prefix, ...args],
          cwd: dirname(configuration.dockerPath),
          env: { ...cli.cliEnv },
          timeoutMs: 15000,
          maxOutputBytes: 262144
        })
      } finally {
        assertCurrent()
      }
    }
    const daemonArgs = [
      'info',
      '--format',
      '{"ID":{{json .ID}},"OSType":{{json .OSType}},"Architecture":{{json .Architecture}},"ServerVersion":{{json .ServerVersion}}}'
    ]
    const daemon = taskDockerDaemon(await invoke(daemonArgs))
    const image = taskDockerImage(
      await invoke(['image', 'inspect', configuration.imageId]),
      configuration.imageId
    )
    if (!isDeepStrictEqual(taskDockerDaemon(await invoke(daemonArgs)), daemon)) {
      return refuseTaskExecution('FORBIDDEN')
    }
    assertCurrent()
    return {
      owner,
      policy: {
        trustMode: 'enforced_autonomous',
        executionPolicyRef: TASK_DOCKER_ENFORCEMENT_POLICY,
        executionPolicyRevision: TASK_DOCKER_ENFORCEMENT_REVISION,
        enforcementEvidenceRef: `docker-enforcement:${canonicalAgentSessionDigest({ owner, configuration, executable, daemon, image, boundary: `${TASK_DOCKER_ENFORCEMENT_POLICY}:${TASK_DOCKER_ENFORCEMENT_REVISION}` })}`
      },
      daemon,
      assertCurrent
    }
  } catch {
    return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
}
