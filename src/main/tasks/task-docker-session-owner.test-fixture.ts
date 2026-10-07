import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/run-process'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionExecutionHostWitness } from '../../shared/agent-session-execution-host-proof'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { taskStructuredFixture } from './task-structured-reservation.test-fixture'
import { taskWorkspace, TASK_TEST_NOW } from './task-execution.test-fixture'
import { taskDockerBinding, type TaskDockerIdentity } from './task-docker-identity'

const roots: string[] = []
export const OWNER_CID = 'b'.repeat(64)
export const OWNER_IMAGE = `sha256:${'a'.repeat(64)}`
afterEach(async () => {
  closeTestJournalHostDatabases()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

export async function dockerSessionFixture(
  live = true,
  persistCid = true,
  artifacts = resolve('logs/paperclip-development/p3/controlled-runtime/owner-writer/tmp')
) {
  await mkdir(artifacts, { recursive: true })
  const directory = await mkdtemp(join(artifacts, 'owner-'))
  roots.push(directory)
  const workspace = taskWorkspace(directory)
  await mkdir(workspace.executionPath)
  const stat = await lstat(workspace.executionPath, { bigint: true })
  const fixture = taskStructuredFixture({
    ...workspace,
    directoryIdentity: {
      dev: String(stat.dev),
      ino: String(stat.ino),
      birthtimeNs: String(stat.birthtimeNs)
    }
  })
  const store = await openTestAgentSessionRecordStore(directory)
  await store.tasks.admit(fixture.admission)
  await store.tasks.beginDispatch(fixture.command, TASK_TEST_NOW, fixture.validate)
  await store.admitOperation({
    callerKey: fixture.origin.operationCallerKey,
    operationId: fixture.origin.operationId,
    fingerprint: fixture.origin.launchFingerprint,
    now: TASK_TEST_NOW
  })
  await store.claimOperation({
    callerKey: fixture.origin.operationCallerKey,
    operationId: fixture.origin.operationId
  })
  const reserved = await store.reserveOwner(fixture.request)
  const task = store.tasks.get(fixture.command)
  if (!task) {
    throw new Error('fixture task missing')
  }
  const pending: TaskDockerIdentity = {
    dockerPath: process.execPath,
    endpoint:
      process.platform === 'win32'
        ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
        : process.platform === 'darwin'
          ? 'unix:///Users/fixture/.docker/run/docker.sock'
          : 'unix:///var/run/docker.sock',
    imageId: OWNER_IMAGE,
    ...taskDockerBinding(task),
    daemon: {
      ID: 'daemon:original',
      OSType: 'linux',
      Architecture: 'amd64',
      ServerVersion: '29.8.1'
    },
    containerId: null
  }
  await store.tasks.persistDockerIdentity(fixture.command, pending, TASK_TEST_NOW, fixture.validate)
  if (persistCid) {
    await store.tasks.persistDockerIdentity(
      fixture.command,
      { ...pending, containerId: OWNER_CID },
      TASK_TEST_NOW,
      fixture.validate
    )
  }
  if (live) {
    const spawnToken = reserved.record.lease.reservedSpawnToken
    if (!spawnToken) {
      throw new Error('original fixture reservation token missing')
    }
    await store.commitProcessIdentity({
      sessionId: fixture.request.sessionId,
      fence: reserved.record.lease.runtimeFence,
      process: {
        hostId: 'local',
        pid: 4242,
        processStartTimeMs: TASK_TEST_NOW,
        spawnToken
      },
      now: TASK_TEST_NOW
    })
    await store.proveOwner({
      sessionId: fixture.request.sessionId,
      fence: reserved.record.lease.runtimeFence,
      link: {
        linkId: 'link-docker',
        handle: { provider: 'codex', threadId: 'thread-docker' },
        origin: 'created',
        mintedAtFence: reserved.record.lease.runtimeFence,
        observedAt: TASK_TEST_NOW
      },
      now: TASK_TEST_NOW
    })
  }
  function record(): AgentSessionRecord {
    const value = store.getRecord(fixture.request.sessionId)
    if (!value) {
      throw new Error('fixture session missing')
    }
    return value
  }
  return { ...fixture, store, directory, pending, record }
}

export function executionWitness(record: AgentSessionRecord): AgentSessionExecutionHostWitness {
  if (!record.taskSource || !record.lease.reservedSpawnToken) {
    throw new Error('fixture binding missing')
  }
  return {
    sessionId: record.sessionId,
    hostId: 'local',
    source: record.taskSource,
    ownerFence: record.lease.runtimeFence,
    spawnToken: record.lease.reservedSpawnToken,
    daemonId: 'daemon:original',
    containerId: OWNER_CID,
    imageId: OWNER_IMAGE
  }
}

export function dockerOwnerRunner(fixture: Awaited<ReturnType<typeof dockerSessionFixture>>) {
  const identity = { ...fixture.pending, containerId: OWNER_CID }
  const container = {
    Id: OWNER_CID,
    Name: `/${identity.name}`,
    Image: OWNER_IMAGE,
    Platform: 'linux',
    Config: { Image: OWNER_IMAGE, Labels: { ...identity.labels } },
    HostConfig: {
      Mounts: [{ Type: 'bind', Source: fixture.task.workspace.executionPath, Target: '/workspace' }]
    },
    Mounts: [
      {
        Type: 'bind',
        Source: fixture.task.workspace.executionPath,
        Destination: '/workspace',
        RW: true,
        Propagation: 'rprivate'
      }
    ],
    State: {
      Status: 'running',
      Running: true,
      Paused: false,
      Restarting: false,
      Dead: false,
      Pid: 231,
      StartedAt: '2026-10-05T00:00:00Z',
      FinishedAt: '0001-01-01T00:00:00Z'
    }
  }
  let keepLive = false
  let missing = false
  let beforeRun: ((spec: ProcessSpec) => Promise<void> | void) | undefined
  const daemon = { ...identity.daemon }
  function result(stdout = '', code = 0, stderr = ''): ProcessResult {
    return { code, stdout, stderr, signal: null, timedOut: false, outputTruncated: false }
  }
  function exit() {
    container.State = {
      ...container.State,
      Status: 'exited',
      Running: false,
      Pid: 0,
      FinishedAt: '2026-10-05T00:01:00Z'
    }
  }
  const run = vi.fn(async (spec: ProcessSpec) => {
    await beforeRun?.(spec)
    const args = (spec.args ?? []).slice(4)
    if (args[0] === 'info') {
      return result(JSON.stringify(daemon))
    }
    if (args[0] === 'container') {
      return missing
        ? result('', 1, `Error: No such object: ${args[2]}`)
        : result(JSON.stringify([container]))
    }
    if (args[0] === 'kill') {
      if (!keepLive) {
        exit()
      }
      return result(OWNER_CID)
    }
    throw new Error('unexpected Docker mutation')
  })
  return {
    run,
    identity,
    daemon,
    container,
    exit,
    keepLive: () => {
      keepLive = true
    },
    missing: () => {
      missing = true
    },
    before: (action: typeof beforeRun) => {
      beforeRun = action
    }
  }
}

export async function personalSessionFixture(
  fixture: Awaited<ReturnType<typeof dockerSessionFixture>>
) {
  const { taskOrigin: _taskOrigin, ...request } = fixture.request
  const sessionId = 'session-personal-one'
  const operationId = `${TASK_TEST_NOW}-${'d'.repeat(32)}`
  const reserved = await fixture.store.reserveOwner({
    ...request,
    sessionId,
    handoffOperationId: operationId,
    operation: { ...request.operation, operationId }
  })
  const spawnToken = reserved.record.lease.reservedSpawnToken
  if (!spawnToken) {
    throw new Error('original fixture reservation token missing')
  }
  return fixture.store.commitProcessIdentity({
    sessionId,
    fence: reserved.record.lease.runtimeFence,
    process: {
      hostId: 'local',
      pid: 4243,
      processStartTimeMs: TASK_TEST_NOW,
      spawnToken
    },
    now: TASK_TEST_NOW
  })
}
