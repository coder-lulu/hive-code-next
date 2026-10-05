import { dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import {
  TaskDigest,
  TaskEpoch,
  TaskOpaqueRef
} from '../../shared/task-execution/task-execution-primitives'
import { refuseTaskExecution } from './task-execution-error'
import { TaskExecutionWorkspaceSchema, type TaskExecutionRecord } from './task-execution-record'
import { taskDockerBinding } from './task-docker-identity'

export type TaskDockerRecord = Pick<TaskExecutionRecord, 'workspace' | 'commandFingerprint'> & {
  command: Pick<
    TaskExecutionRecord['command'],
    'runtimeRecordId' | 'ownershipEpoch' | 'executionId' | 'executionEpoch'
  >
}

const BindingSchema = z.strictObject({
  runtimeRecordId: TaskOpaqueRef,
  ownershipEpoch: TaskEpoch,
  executionId: TaskOpaqueRef,
  executionEpoch: TaskEpoch,
  commandFingerprint: TaskDigest
})
export const TASK_DOCKER_SAFE_ENV = Object.freeze({
  HOME: '/home/hive',
  CODEX_HOME: '/home/hive/.codex',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  NODE_ENV: 'production',
  ORCA_BACKGROUND_LAUNCH: '1'
})
export const TASK_DOCKER_TMPFS = Object.freeze({
  '/tmp': 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=1777',
  '/home/hive': 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700'
})

function requireLocalEndpoint(endpoint: string): void {
  if (/[\0\r\n]/.test(endpoint)) {
    refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
  const valid =
    process.platform === 'win32'
      ? endpoint === 'npipe:////./pipe/dockerDesktopLinuxEngine'
      : process.platform === 'linux'
        ? endpoint === 'unix:///var/run/docker.sock'
        : process.platform === 'darwin' &&
          /^unix:\/\/\/Users\/[^/\s]+\/(?:\.docker\/run\/docker\.sock|Library\/Containers\/com\.docker\.docker\/Data\/docker\.raw\.sock)$/.test(
            endpoint
          )
  if (!valid) {
    refuseTaskExecution('CAPABILITY_UNAVAILABLE')
  }
}

export function taskDockerConfiguration(options: {
  dockerPath: string
  endpoint: string
  imageId: string
  record: TaskDockerRecord
}) {
  const binding = BindingSchema.safeParse({
    runtimeRecordId: options.record.command.runtimeRecordId,
    ownershipEpoch: options.record.command.ownershipEpoch,
    executionId: options.record.command.executionId,
    executionEpoch: options.record.command.executionEpoch,
    commandFingerprint: options.record.commandFingerprint
  })
  const workspace = TaskExecutionWorkspaceSchema.safeParse(options.record.workspace)
  if (
    !binding.success ||
    !workspace.success ||
    !workspace.data.directoryIdentity ||
    options.imageId.length !== 71 ||
    !options.imageId.startsWith('sha256:') ||
    !TaskDigest.safeParse(options.imageId.slice(7)).success ||
    !isAbsolute(options.dockerPath) ||
    /[\0\r\n]/.test(options.dockerPath) ||
    !isAbsolute(workspace.data.executionPath) ||
    /[,\0\r\n]/.test(workspace.data.executionPath)
  ) {
    return refuseTaskExecution('INVALID_REQUEST')
  }
  requireLocalEndpoint(options.endpoint)
  const { name, labels } = taskDockerBinding({
    ...binding.data,
    command: binding.data,
    workspace: workspace.data
  })
  const cliEnv: Record<string, string> = { ORCA_BACKGROUND_LAUNCH: '1' }
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const value = process.env[key]
    if (value) {
      cliEnv[key] = value
    }
  }
  const configDirectory = join(dirname(workspace.data.executionPath), `.${name}-docker-empty`)
  const prefix = ['--config', configDirectory, '--host', options.endpoint]
  const createArgs = [
    'create',
    '--name',
    name,
    '--pull=never',
    '--interactive',
    '--read-only',
    '--network=none',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=1000:1000',
    '--pids-limit=128',
    '--memory=512m',
    '--memory-swap=512m',
    '--cpus=1',
    '--ipc=none',
    '--cgroupns=private',
    '--runtime=runc',
    '--restart=no',
    '--no-healthcheck',
    '--entrypoint=/usr/local/bin/node',
    '--workdir=/workspace',
    '--mount',
    `type=bind,source=${workspace.data.executionPath},target=/workspace,bind-propagation=rprivate`
  ]
  for (const [key, value] of Object.entries(TASK_DOCKER_SAFE_ENV)) {
    createArgs.push('--env', `${key}=${value}`)
  }
  for (const [path, value] of Object.entries(TASK_DOCKER_TMPFS)) {
    createArgs.push('--tmpfs', `${path}:${value}`)
  }
  for (const [key, value] of Object.entries(labels)) {
    createArgs.push('--label', `${key}=${value}`)
  }
  createArgs.push(options.imageId, '/opt/hive/codex-worker.mjs')
  return Object.freeze({
    ...options,
    workspace: workspace.data,
    name,
    labels,
    cliEnv,
    configDirectory,
    prefix,
    // A regular executable cannot contain config.json or Docker contexts. Cleanup
    // stays independent of a removed workspace or an occupied launch config sibling.
    cleanupPrefix: ['--config', options.dockerPath, '--host', options.endpoint],
    createArgs
  })
}

export type TaskDockerConfiguration = ReturnType<typeof taskDockerConfiguration>

export function taskDockerEnvironment(env: string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const item of env) {
    const separator = item.indexOf('=')
    const key = item.slice(0, separator)
    const value = item.slice(separator + 1)
    if (separator < 1 || /[\0\r\n]/.test(item) || Object.hasOwn(values, key)) {
      refuseTaskExecution('FORBIDDEN')
    }
    Object.defineProperty(values, key, { value, enumerable: true })
  }
  return values
}

export function taskDockerImageEnvironment(env: string[]): Record<string, string> {
  const values = taskDockerEnvironment(env)
  for (const [key, value] of Object.entries(values)) {
    const version =
      (key === 'NODE_VERSION' || key === 'YARN_VERSION') && /^\d+\.\d+\.\d+$/.test(value)
    const fixed = Object.entries(TASK_DOCKER_SAFE_ENV).some(
      ([safeKey, safeValue]) => key === safeKey && value === safeValue
    )
    const nodePath =
      key === 'PATH' && value === '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    if (!version && !fixed && !nodePath) {
      refuseTaskExecution('FORBIDDEN')
    }
  }
  return { ...values, ...TASK_DOCKER_SAFE_ENV }
}
