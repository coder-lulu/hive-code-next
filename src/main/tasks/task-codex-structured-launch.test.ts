import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOwner } from '../native-chat/agent-session-wire/structured-agent-session-acquisition'
import { isCodexAppServerHandshakeExitUnprovenError } from '../codex/codex-app-server-handshake-exit-proof'
import { taskCodexRuntimeFixture } from './task-codex-runtime.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { CID, dockerArgs } from './task-docker-boundary.test-fixture'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'

let fixture: Awaited<ReturnType<typeof taskCodexRuntimeFixture>> | undefined
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  fixture?.docker.keepLive(false)
  await fixture?.adapter.closeAll()
  vi.restoreAllMocks()
  fixture = undefined
})

async function prepare() {
  fixture = await taskCodexRuntimeFixture()
  return fixture
}
async function open(f: Awaited<ReturnType<typeof prepare>>) {
  const launch = await f.taskRuntime.resolveLaunch(f.acquireInput, f.record)
  if (!launch.openTaskConnection) {
    throw new Error('controlled Task opener missing')
  }
  return launch.openTaskConnection({
    onSpawned: async (pid) => {
      await f.store.commitProcessIdentity({
        sessionId: f.record.sessionId,
        fence: f.record.lease.runtimeFence,
        process: {
          hostId: 'local',
          pid,
          spawnToken: f.acquireInput.spawnToken,
          processStartTimeMs: TASK_TEST_NOW - 1000
        },
        now: TASK_TEST_NOW
      })
    }
  })
}

describe('original structured acquisition to controlled Docker', () => {
  it('opens through the real original adapter/store boundary and never resolves a native command or environment', async () => {
    const f = await prepare()
    const acquired = await acquireOwner(f.flow, f.record)
    expect(acquired.record.lease.claimStatus).toBe('live')
    expect(acquired.record.taskSource).toEqual(f.origin.source)
    expect(f.store.tasks.get(f.command)?.dockerIdentity?.containerId).toBe(CID)
    expect(f.openDocker).toHaveBeenCalledOnce()
    expect(f.nativeOpen).not.toHaveBeenCalled()
    expect(f.nativeCommand).not.toHaveBeenCalled()
    expect(f.nativeEnvironment).not.toHaveBeenCalled()
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(
      f.codex.connections[0]?.calls.find((call) => call.method === 'thread/start')?.params
    ).toMatchObject({
      cwd: '/workspace',
      model: 'gpt-6.1-sol',
      modelProvider: 'hive-loopback',
      approvalPolicy: 'never',
      sandbox: 'workspace-write'
    })
    const probe = await f.taskRuntime.probeOwner(acquired.record)
    expect(probe.outcome).toBe('execution-host-live')
    expect(f.docker.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(true)
    await f.adapter.closeAll()
    expect(
      (
        await f.taskRuntime.stopExecutionOwner(
          f.store.getRecord(f.record.sessionId) ?? acquired.record
        )
      )?.outcome
    ).toBe('execution-host-exited')
  })
  it('refuses missing Task origin without native fallback or Docker effects', async () => {
    const f = await prepare()
    delete f.flow.params.taskOrigin
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow()
    expect(f.openDocker).not.toHaveBeenCalled()
    expect(f.docker.run).not.toHaveBeenCalled()
    expect(f.nativeOpen).not.toHaveBeenCalled()
    expect(f.nativeEnvironment).not.toHaveBeenCalled()
  })
  it('rechecks the original grant before any actual Docker effect', async () => {
    const f = await prepare()
    f.validate.mockImplementation(() => {
      throw new Error('grant-revoked')
    })
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow()
    expect(f.docker.run).not.toHaveBeenCalled()
    expect(f.resolvePinned).not.toHaveBeenCalled()
    expect(f.nativeOpen).not.toHaveBeenCalled()
  })
  it('refuses a mismatched inner acquisition fence', async () => {
    const f = await prepare()
    await expect(
      f.taskRuntime.resolveLaunch({ ...f.acquireInput, fence: f.acquireInput.fence + 1 }, f.record)
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.docker.run).not.toHaveBeenCalled()
  })
  it('reports unavailable deployment explicitly before Docker or provider effects', async () => {
    const f = await prepare()
    f.resolveDockerConfiguration.mockImplementation(() => {
      throw new Error('TASK_DOCKER_RUNTIME_UNAVAILABLE')
    })
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow('TASK_DOCKER_RUNTIME_UNAVAILABLE')
    expect(f.docker.run).not.toHaveBeenCalled()
    expect(f.nativeOpen).not.toHaveBeenCalled()
    expect(f.readAuth).not.toHaveBeenCalled()
  })
  it('preserves the actual connection closed getter through the account lifetime wrapper', async () => {
    const f = await prepare()
    const connection = await open(f)
    expect(connection.closed).toBe(false)
    await expect(connection.close()).resolves.toBe(true)
    expect(connection.closed).toBe(true)
    expect(f.unsubscribe).toHaveBeenCalledOnce()
  })
  it('closes the same original boundary when account metadata is revoked', async () => {
    const f = await prepare()
    const connection = await open(f)
    f.revoke()
    f.accountsChanged()
    await expect(connection.close()).resolves.toBe(true)
    expect(f.docker.container().State.Running).toBe(false)
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })
  it('retains cleanup uncertainty while the same CID still runs and permits a bounded retry', async () => {
    const f = await prepare()
    const connection = await open(f)
    f.docker.keepLive(true)
    await expect(connection.close()).resolves.toBe(false)
    const record = f.store.getRecord(f.record.sessionId)
    if (!record) {
      throw new Error('original record missing')
    }
    expect((await f.taskRuntime.probeOwner(record)).outcome).toBe('execution-host-live')
    f.docker.keepLive(false)
    await expect(connection.close()).resolves.toBe(true)
  })
  it('retains a failed opener when all container writers cannot be proven stopped', async () => {
    const f = await prepare()
    f.openDocker.mockImplementation(async () => {
      f.docker.start()
      throw new Error('attach-failed')
    })
    f.docker.keepLive(true)
    try {
      await open(f)
      throw new Error('unexpected success')
    } catch (error) {
      expect(isCodexAppServerHandshakeExitUnprovenError(error)).toBe(true)
      if (!isCodexAppServerHandshakeExitUnprovenError(error)) {
        throw error
      }
      await expect(error.connection.close()).resolves.toBe(false)
      f.docker.keepLive(false)
      await expect(error.connection.close()).resolves.toBe(true)
    }
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })
  it('rejects a cold/uncertain original owner rather than creating another Docker generation', async () => {
    const f = await prepare()
    const connection = await open(f)
    const cold = await openTestAgentSessionRecordStore(f.directory)
    const observed = cold.getRecord(f.record.sessionId)
    if (!observed) {
      throw new Error('cold original record missing')
    }
    await expect(f.taskRuntime.resolveLaunch(f.acquireInput, observed)).rejects.toThrow()
    expect(f.openDocker).toHaveBeenCalledOnce()
    expect(
      f.docker.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'create')
    ).toHaveLength(1)
    await connection.close()
  })
})
