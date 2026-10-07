import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOwner } from '../native-chat/agent-session-wire/structured-agent-session-acquisition'
import { taskCodexRuntimeFixture } from './task-codex-runtime.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { dockerArgs } from './task-docker-boundary.test-fixture'

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
  const dispatch = fixture.origin.dispatch
  if (!dispatch) {
    throw new Error('synthetic dispatch fixture missing')
  }
  return { ...fixture, dispatch }
}

describe('controlled Task dispatch authority', () => {
  it('refuses missing private dispatch before Docker or native effects', async () => {
    const f = await prepare()
    delete f.origin.dispatch
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow()
    expect(f.docker.run).not.toHaveBeenCalled()
    expect(f.openDocker).not.toHaveBeenCalled()
    expect(f.nativeOpen).not.toHaveBeenCalled()
  })
  it('refuses an asynchronous dispatch guard before Docker effects', async () => {
    const f = await prepare()
    f.dispatch.assertCurrent = async () => undefined
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow()
    expect(f.docker.run).not.toHaveBeenCalled()
  })
  it('refuses failed fresh preparation before Docker effects', async () => {
    const f = await prepare()
    f.dispatch.prepare = async () => {
      throw new Error('private-lease-revoked')
    }
    await expect(acquireOwner(f.flow, f.record)).rejects.toThrow('private-lease-revoked')
    expect(f.docker.run).not.toHaveBeenCalled()
  })
  it('requires the original process checkpoint ACK before accepting an opened transport', async () => {
    const f = await prepare()
    const launch = await f.taskRuntime.resolveLaunch(f.acquireInput, f.record)
    if (!launch.openTaskConnection) {
      throw new Error('controlled opener missing')
    }
    await expect(launch.openTaskConnection({ onSpawned: async () => undefined })).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.store.getRecord(f.record.sessionId)?.lease.ownerProcess).toBeNull()
    expect(f.docker.container().State.Running).toBe(false)
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })
  it('refreshes before each physical create/attach and keeps the committed owner usable after startup proof expires', async () => {
    const f = await prepare()
    let current = false
    let refreshes = 0
    f.dispatch.prepare = async () => {
      current = true
      refreshes += 1
    }
    f.dispatch.assertCurrent = () => {
      if (!current) {
        throw new Error('dispatch-expired')
      }
    }
    const run = f.docker.run.getMockImplementation()
    if (!run) {
      throw new Error('Docker fixture runner missing')
    }
    f.docker.run.mockImplementation(async (spec) => {
      if (dockerArgs(spec)[0] === 'create') {
        expect(current).toBe(true)
      }
      const result = await run(spec)
      current = false
      return result
    })
    const opener = f.openDocker.getMockImplementation()
    if (!opener) {
      throw new Error('Docker fixture opener missing')
    }
    f.openDocker.mockImplementation(async (launch, handlers, spawn) => {
      expect(current).toBe(true)
      current = false
      return opener(launch, handlers, spawn)
    })
    const acquired = await acquireOwner(f.flow, f.record)
    expect(acquired.record.lease.claimStatus).toBe('live')
    expect(refreshes).toBeGreaterThanOrEqual(3)
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.nativeOpen).not.toHaveBeenCalled()
  })
})
