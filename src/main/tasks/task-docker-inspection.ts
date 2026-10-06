import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ProcessResult } from '../../shared/child-process/run-process'
import { refuseTaskExecution } from './task-execution-error'
import { TaskDockerDaemonSchema } from './task-docker-identity'
import {
  TASK_DOCKER_TMPFS,
  taskDockerEnvironment,
  taskDockerImageEnvironment,
  type TaskDockerConfiguration
} from './task-docker-configuration'
import {
  assertTaskDockerMounts,
  TaskDockerGuestMountSchema,
  TaskDockerHostMountSchema
} from './task-docker-mounts'

const EnvSchema = z.array(z.string().max(1024)).max(32)
const Empty = z.union([z.null(), z.array(z.never()).length(0), z.strictObject({})]).optional()
const ImageSchema = z.object({
  Id: z.string(),
  Os: z.literal('linux'),
  Architecture: z.literal('amd64'),
  Config: z.object({ Env: EnvSchema, Labels: Empty, Volumes: Empty, ExposedPorts: Empty })
})
const ContainerSchema = z.object({
  Id: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  Name: z.string(),
  Image: z.string(),
  Platform: z.literal('linux'),
  Path: z.literal('/usr/local/bin/node'),
  Args: z.tuple([z.literal('/opt/hive/codex-worker.mjs')]),
  RestartCount: z.literal(0),
  Config: z.object({
    Image: z.string(),
    User: z.literal('1000:1000'),
    WorkingDir: z.literal('/workspace'),
    Entrypoint: z.tuple([z.literal('/usr/local/bin/node')]),
    Cmd: z.tuple([z.literal('/opt/hive/codex-worker.mjs')]),
    Env: EnvSchema,
    Labels: z.record(z.string(), z.string()),
    Tty: z.literal(false),
    OpenStdin: z.literal(true),
    StdinOnce: z.literal(true),
    AttachStdin: z.literal(true),
    AttachStdout: z.literal(true),
    AttachStderr: z.literal(true),
    Volumes: Empty,
    ExposedPorts: Empty,
    Healthcheck: z.object({ Test: z.tuple([z.literal('NONE')]) })
  }),
  HostConfig: z.object({
    ReadonlyRootfs: z.literal(true),
    NetworkMode: z.literal('none'),
    Privileged: z.literal(false),
    CapDrop: z.tuple([z.literal('ALL')]),
    CapAdd: Empty,
    SecurityOpt: z.tuple([z.literal('no-new-privileges')]),
    PidsLimit: z.literal(128),
    Memory: z.literal(536870912),
    MemorySwap: z.literal(536870912),
    NanoCpus: z.literal(1000000000),
    PidMode: z.literal(''),
    IpcMode: z.literal('none'),
    CgroupnsMode: z.literal('private'),
    UTSMode: z.literal(''),
    UsernsMode: z.literal(''),
    AutoRemove: z.literal(false),
    RestartPolicy: z.strictObject({ Name: z.literal('no'), MaximumRetryCount: z.literal(0) }),
    Binds: Empty,
    Mounts: z.array(TaskDockerHostMountSchema).min(1).max(2),
    Tmpfs: z.record(z.string(), z.string()),
    PortBindings: Empty,
    PublishAllPorts: z.literal(false),
    Devices: Empty,
    DeviceRequests: Empty,
    DeviceCgroupRules: Empty,
    VolumesFrom: Empty,
    Links: Empty,
    ExtraHosts: Empty,
    GroupAdd: Empty,
    Sysctls: Empty,
    Annotations: Empty,
    Dns: Empty,
    DnsOptions: Empty,
    DnsSearch: Empty,
    StorageOpt: Empty,
    Runtime: z.literal('runc'),
    Init: z.union([z.literal(false), z.null()]).optional(),
    Isolation: z.literal('').optional(),
    CpuShares: z.literal(0).optional(),
    CpuPeriod: z.literal(0).optional(),
    CpuQuota: z.literal(0).optional(),
    CpuRealtimePeriod: z.literal(0).optional(),
    CpuRealtimeRuntime: z.literal(0).optional(),
    CpusetCpus: z.literal('').optional(),
    CpusetMems: z.literal('').optional(),
    CgroupParent: z.literal('').optional(),
    Cgroup: z.literal('').optional(),
    OomKillDisable: z.union([z.literal(false), z.null()]).optional(),
    Ulimits: Empty
  }),
  Mounts: z.array(TaskDockerGuestMountSchema).min(1).max(2),
  NetworkSettings: z.object({
    Networks: z.strictObject({
      none: z.object({
        IPAddress: z.literal(''),
        Gateway: z.literal(''),
        GlobalIPv6Address: z.literal(''),
        IPv6Gateway: z.literal('')
      })
    })
  }),
  State: z.object({
    Status: z.string(),
    Running: z.boolean(),
    Paused: z.boolean(),
    Restarting: z.boolean(),
    Dead: z.boolean(),
    Pid: z.number().int().min(0),
    StartedAt: z.string(),
    FinishedAt: z.string()
  })
})
const ContainerIdentitySchema = ContainerSchema.pick({
  Id: true,
  Name: true,
  Image: true,
  Platform: true,
  Mounts: true,
  State: true
}).extend({
  Config: ContainerSchema.shape.Config.pick({ Image: true, Labels: true }),
  HostConfig: ContainerSchema.shape.HostConfig.pick({ Mounts: true })
})

export function taskDockerJson(result: ProcessResult): unknown {
  if (
    result.code !== 0 ||
    result.signal ||
    result.timedOut ||
    result.outputTruncated ||
    Buffer.byteLength(result.stdout) > 262144
  ) {
    refuseTaskExecution('OUTCOME_UNKNOWN')
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    return refuseTaskExecution('OUTCOME_UNKNOWN')
  }
}
function parseOrRefuse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : refuseTaskExecution('FORBIDDEN')
}
export function taskDockerDaemon(result: ProcessResult) {
  return parseOrRefuse(TaskDockerDaemonSchema, taskDockerJson(result))
}
export function taskDockerImage(result: ProcessResult, imageId: string): Record<string, string> {
  const [image] = parseOrRefuse(z.tuple([ImageSchema]), taskDockerJson(result))
  if (image.Id !== imageId) {
    refuseTaskExecution('FORBIDDEN')
  }
  return taskDockerImageEnvironment(image.Config.Env)
}
export function taskDockerContainer(
  result: ProcessResult,
  expected: TaskDockerConfiguration,
  env: Record<string, string>,
  containerId: string | null
) {
  const [container] = parseOrRefuse(z.tuple([ContainerSchema]), taskDockerJson(result))
  assertContainerIdentity(container, expected, containerId)
  if (
    !isDeepStrictEqual(taskDockerEnvironment(container.Config.Env), env) ||
    !isDeepStrictEqual(container.HostConfig.Tmpfs, TASK_DOCKER_TMPFS)
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  return container
}
export type TaskDockerContainer = ReturnType<typeof taskDockerContainer>
function assertContainerIdentity(
  container: z.output<typeof ContainerIdentitySchema>,
  expected: TaskDockerConfiguration,
  containerId: string | null
): void {
  if (
    (containerId && container.Id !== containerId) ||
    container.Name !== `/${expected.name}` ||
    container.Image !== expected.imageId ||
    container.Config.Image !== expected.imageId ||
    !isDeepStrictEqual(container.Config.Labels, expected.labels)
  ) {
    refuseTaskExecution('FORBIDDEN')
  }
  assertTaskDockerMounts(container, expected)
}
/** Mutable limits and current host paths may revoke launch; they cannot revoke
 * termination of this captured original container. This never admits a launch. */
export function taskDockerCleanupContainer(
  result: ProcessResult,
  expected: TaskDockerConfiguration,
  containerId: string | null
) {
  const [container] = parseOrRefuse(z.tuple([ContainerIdentitySchema]), taskDockerJson(result))
  assertContainerIdentity(container, expected, containerId)
  return container
}
const ZERO_TIME = '0001-01-01T00:00:00Z'
export function taskDockerNeverStarted(container: Pick<TaskDockerContainer, 'State'>): boolean {
  const state = container.State
  return (
    state.Status === 'created' &&
    !state.Running &&
    !state.Dead &&
    !state.Restarting &&
    !state.Paused &&
    state.Pid === 0 &&
    state.StartedAt === ZERO_TIME &&
    state.FinishedAt === ZERO_TIME
  )
}
export function taskDockerVerdict(
  container: Pick<TaskDockerContainer, 'State'>
): 'live' | 'unverifiable' | 'exited' {
  const state = container.State
  if (
    state.Running &&
    state.Pid > 0 &&
    !state.Dead &&
    ['running', 'paused'].includes(state.Status)
  ) {
    return 'live'
  }
  if (
    state.Status === 'exited' &&
    !state.Running &&
    !state.Dead &&
    !state.Restarting &&
    !state.Paused &&
    state.Pid === 0 &&
    state.StartedAt !== ZERO_TIME &&
    state.FinishedAt !== ZERO_TIME &&
    Number.isFinite(Date.parse(state.StartedAt)) &&
    Number.isFinite(Date.parse(state.FinishedAt))
  ) {
    return 'exited'
  }
  return 'unverifiable'
}
