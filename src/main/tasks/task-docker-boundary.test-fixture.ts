import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/run-process'
import { createTaskDockerBoundary } from './task-docker-boundary'
import type { TaskDockerIdentity } from './task-docker-identity'

export const IMAGE = `sha256:${'a'.repeat(64)}`
export const CID = 'b'.repeat(64)
export const ENDPOINT =
  process.platform === 'win32'
    ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
    : process.platform === 'darwin'
      ? 'unix:///Users/fixture/.docker/run/docker.sock'
      : 'unix:///var/run/docker.sock'
export const dockerArgs = (spec: ProcessSpec) => (spec.args ?? []).slice(4)
const ZERO_TIME = '0001-01-01T00:00:00Z'
const SAFE_ENV = [
  'PATH=/usr/local/bin:/usr/bin:/bin',
  'NODE_VERSION=24.18.0',
  'YARN_VERSION=1.22.22',
  'HOME=/home/hive',
  'CODEX_HOME=/home/hive/.codex',
  'NODE_ENV=production',
  'ORCA_BACKGROUND_LAUNCH=1'
]
const TMPFS = {
  '/tmp': 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=1777',
  '/home/hive': 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700'
}
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export function result(stdout = '', code = 0, stderr = ''): ProcessResult {
  return { code, stdout, stderr, signal: null, timedOut: false, outputTruncated: false }
}

export async function taskDockerFixture() {
  const directory = resolve('logs/paperclip-development/p3/host-qualification/boundary')
  await mkdir(directory, { recursive: true })
  const root = await mkdtemp(resolve(directory, 'fixture-'))
  roots.push(root)
  const executionPath = resolve(root, 'workspace')
  await mkdir(executionPath)
  const stat = await lstat(executionPath, { bigint: true })
  const record = {
    command: {
      runtimeRecordId: 'runtime:original',
      ownershipEpoch: 1,
      executionId: 'execution:original',
      executionEpoch: 2
    },
    commandFingerprint: 'c'.repeat(64),
    workspace: {
      hostId: 'local' as const,
      workspaceId: 'workspace:original',
      canonicalPath: executionPath,
      executionPath,
      isolation: 'managed_copy' as const,
      directoryIdentity: {
        dev: stat.dev.toString(),
        ino: stat.ino.toString(),
        birthtimeNs: stat.birthtimeNs.toString()
      }
    }
  }
  const image = {
    Id: IMAGE,
    Os: 'linux',
    Architecture: 'amd64',
    Config: {
      Env: SAFE_ENV.slice(0, 3),
      Labels: null,
      Volumes: null,
      ExposedPorts: null
    }
  }
  const daemon = {
    ID: 'daemon:original',
    OSType: 'linux',
    Architecture: 'x86_64',
    ServerVersion: '29.8.1'
  }
  let container: ReturnType<typeof makeContainer> | null = null
  let revoked = false
  let lostCreate = false
  let killLeavesLive = false
  let beforeRun: ((spec: ProcessSpec) => Promise<void> | void) | undefined
  function makeContainer(name: string, labels: Record<string, string>) {
    return {
      Id: CID,
      Name: `/${name}`,
      Image: IMAGE,
      Platform: 'linux',
      Path: '/usr/local/bin/node',
      Args: ['/opt/hive/codex-worker.mjs'],
      RestartCount: 0,
      Config: {
        Image: IMAGE,
        User: '1000:1000',
        WorkingDir: '/workspace',
        Entrypoint: ['/usr/local/bin/node'],
        Cmd: ['/opt/hive/codex-worker.mjs'],
        Env: [...SAFE_ENV],
        Labels: labels,
        Tty: false,
        OpenStdin: true,
        StdinOnce: true,
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Volumes: null,
        ExposedPorts: null,
        Healthcheck: { Test: ['NONE'] }
      },
      HostConfig: {
        ReadonlyRootfs: true,
        NetworkMode: 'none',
        Privileged: false,
        CapDrop: ['ALL'],
        CapAdd: null,
        SecurityOpt: ['no-new-privileges'],
        PidsLimit: 128,
        Memory: 536870912,
        MemorySwap: 536870912,
        NanoCpus: 1000000000,
        PidMode: '',
        IpcMode: 'none',
        CgroupnsMode: 'private',
        UTSMode: '',
        UsernsMode: '',
        AutoRemove: false,
        RestartPolicy: { Name: 'no', MaximumRetryCount: 0 },
        Binds: null,
        Mounts: [{ Type: 'bind', Source: executionPath, Target: '/workspace' }],
        Tmpfs: { ...TMPFS },
        PortBindings: {},
        PublishAllPorts: false,
        Devices: [],
        DeviceRequests: null,
        DeviceCgroupRules: null,
        VolumesFrom: null,
        Links: null,
        ExtraHosts: null,
        GroupAdd: null,
        Sysctls: null,
        Runtime: 'runc'
      },
      Mounts: [
        {
          Type: 'bind',
          Source: executionPath,
          Destination: '/workspace',
          RW: true,
          Propagation: 'rprivate'
        }
      ],
      NetworkSettings: {
        Networks: { none: { IPAddress: '', Gateway: '', GlobalIPv6Address: '', IPv6Gateway: '' } }
      },
      State: {
        Status: 'created',
        Running: false,
        Paused: false,
        Restarting: false,
        Dead: false,
        Pid: 0,
        StartedAt: ZERO_TIME,
        FinishedAt: ZERO_TIME
      }
    }
  }
  const run = vi.fn(async (spec: ProcessSpec) => {
    await beforeRun?.(spec)
    const args = dockerArgs(spec)
    if (args[0] === 'info') {
      return result(JSON.stringify(daemon))
    }
    if (args[0] === 'image') {
      return result(JSON.stringify([image]))
    }
    if (args[0] === 'container') {
      return container
        ? result(JSON.stringify([container]))
        : result('', 1, `Error: No such object: ${args[2]}`)
    }
    if (args[0] === 'create') {
      const labels: Record<string, string> = {}
      args.forEach((argument, index) => {
        if (argument === '--label') {
          const [key, value] = args[index + 1]!.split('=')
          labels[key!] = value!
        }
      })
      container = makeContainer(args[args.indexOf('--name') + 1]!, labels)
      if (lostCreate) {
        throw new Error('lost create reply')
      }
      return result(`${CID}\n`)
    }
    if (args[0] === 'kill') {
      if (!container || container.State.Status === 'created') {
        return result('', 1, 'not running')
      }
      if (!killLeavesLive) {
        container.State = {
          ...container.State,
          Status: 'exited',
          Running: false,
          Pid: 0,
          FinishedAt: '2026-10-05T00:01:00Z'
        }
      }
      return result(CID)
    }
    throw new Error(`Unexpected Docker command: ${args[0]}`)
  })
  const assertCurrent = () => {
    if (revoked) {
      throw new Error('revoked')
    }
  }
  const options = {
    dockerPath: process.execPath,
    endpoint: ENDPOINT,
    imageId: IMAGE,
    record,
    assertCurrent,
    persistIdentity: vi.fn(async (_identity: TaskDockerIdentity) => undefined),
    run
  }
  return {
    options,
    root,
    image,
    daemon,
    run,
    container: () => container!,
    boundary: () => createTaskDockerBoundary(options),
    revoke: () => {
      revoked = true
    },
    loseCreateReply: () => {
      lostCreate = true
    },
    keepLive: (value: boolean) => {
      killLeavesLive = value
    },
    before: (callback: typeof beforeRun) => {
      beforeRun = callback
    },
    start: () => {
      container!.State = {
        ...container!.State,
        Status: 'running',
        Running: true,
        Pid: 231,
        StartedAt: '2026-10-05T00:00:00Z'
      }
    }
  }
}
