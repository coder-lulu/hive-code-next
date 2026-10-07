import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOwner } from '../native-chat/agent-session-wire/structured-agent-session-acquisition'
import { taskCodexRuntimeFixture } from './task-codex-runtime.test-fixture'
import { dockerArgs, taskDockerFixture } from './task-docker-boundary.test-fixture'
import { probeTaskDockerEnforcement } from './task-docker-enforcement'
import { taskCommand, TASK_TEST_NOW } from './task-execution.test-fixture'

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
  const docker = await taskDockerFixture()
  const command = taskCommand()
  const proof = await probeTaskDockerEnforcement({
    configuration: () => ({
      dockerPath: docker.options.dockerPath,
      endpoint: docker.options.endpoint,
      imageId: docker.options.imageId
    }),
    owner: {
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionAccountRef: command.executionAccountRef
    },
    assertCurrent: () => undefined,
    run: docker.run
  })
  fixture = await taskCodexRuntimeFixture(undefined, {
    policyRevision: 'docker-local-linux:1',
    executionPolicy: proof.policy
  })
  return fixture
}

describe('enforced policy through the original Task Session Docker pipeline', () => {
  it('freshly proves the committed evidence and launches only the original controlled Docker session', async () => {
    const h = await prepare()
    const acquired = await acquireOwner(h.flow, h.record)
    expect(acquired.record.lease.claimStatus).toBe('live')
    expect(h.docker.run.mock.calls.slice(0, 3).map(([spec]) => dockerArgs(spec)[0])).toEqual([
      'info',
      'image',
      'info'
    ])
    expect(h.openDocker).toHaveBeenCalledOnce()
    expect(h.nativeEnvironment).not.toHaveBeenCalled()
    expect(h.nativeCommand).not.toHaveBeenCalled()
    expect(h.nativeOpen).not.toHaveBeenCalled()
  })

  it('refuses a changed actual daemon instead of substituting evidence or native execution', async () => {
    const h = await prepare()
    h.docker.daemon.ID = 'daemon:replacement'
    await expect(acquireOwner(h.flow, h.record)).rejects.toThrow('FORBIDDEN')
    expect(h.openDocker).not.toHaveBeenCalled()
    expect(h.nativeOpen).not.toHaveBeenCalled()
    expect(h.docker.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
  })

  it('rechecks the same proved daemon inside the original boundary before creating', async () => {
    const h = await prepare()
    h.docker.before((spec) => {
      if (dockerArgs(spec)[0] === 'container') {
        h.docker.daemon.ID = 'daemon:replacement'
      }
    })
    await expect(acquireOwner(h.flow, h.record)).rejects.toThrow('FORBIDDEN')
    expect(h.openDocker).not.toHaveBeenCalled()
    expect(h.nativeOpen).not.toHaveBeenCalled()
    expect(h.docker.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
  })
})
