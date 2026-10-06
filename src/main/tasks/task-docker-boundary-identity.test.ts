import { mkdir, rename } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { CID, dockerArgs, result, taskDockerFixture } from './task-docker-boundary.test-fixture'
import type { TaskDockerIdentity } from './task-docker-identity'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function restore(f: Awaited<ReturnType<typeof taskDockerFixture>>, identity: TaskDockerIdentity) {
  return createTaskDockerBoundary({
    ...f.options,
    persistIdentity: undefined,
    recoveryIdentity: identity
  })
}
const created = (f: Awaited<ReturnType<typeof taskDockerFixture>>) =>
  f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'create')

async function neverStartedFixture() {
  const f = await taskDockerFixture(
    resolve('logs/paperclip-development/p3/task-startup-cancellation-proof/boundary-writer/tmp')
  )
  await f.boundary().prepare()
  const identity = structuredClone(f.options.persistIdentity.mock.calls[0]![0])
  const cold = restore(f, identity)
  f.run.mockClear()
  f.options.persistIdentity.mockClear()
  return { ...f, cold, identity }
}

describe('read-only original never-started proof', () => {
  it('retains the second container sample time when the final daemon reply is delayed', async () => {
    const f = await neverStartedFixture()
    const sampledAt = 1_800_000_000_000
    let now = sampledAt
    let inspections = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      f.before((spec) => {
        const args = dockerArgs(spec)
        if (args[0] === 'container') {
          inspections += 1
        }
        if (args[0] === 'info' && inspections === 2) {
          now += 10_001
        }
      })
      const proof = await f.cold.proveNeverStarted()
      expect(proof).toEqual({ containerId: CID, observedAt: sampledAt })
      expect(Date.now() - proof!.observedAt).toBeGreaterThan(10_000)
      expect(f.options.persistIdentity).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
  })

  it('pins the actual CID found by the pending name without granting exit or writing a checkpoint', async () => {
    const f = await neverStartedFixture()
    const before = Date.now()
    const proof = await f.cold.proveNeverStarted()
    expect(proof).toEqual({ containerId: CID, observedAt: expect.any(Number) })
    expect(proof?.observedAt).toBeGreaterThanOrEqual(before)
    expect(proof?.observedAt).toBeLessThanOrEqual(Date.now())
    expect(
      f.run.mock.calls.map(([spec]) => dockerArgs(spec)).filter((args) => args[0] === 'container')
    ).toEqual([
      ['container', 'inspect', f.identity.name],
      ['container', 'inspect', CID]
    ])
    expect(
      f.run.mock.calls.every(([spec]) =>
        ['info', 'image', 'container'].includes(dockerArgs(spec)[0]!)
      )
    ).toBe(true)
    expect(f.options.persistIdentity).not.toHaveBeenCalled()
    expect(await f.cold.inspect()).toBe('unverifiable')
    expect(await f.cold.stop()).toBe(false)
    await expect(f.cold.prepare()).rejects.toThrow('FORBIDDEN')
  })

  it('requires the original persisted recovery identity even when a launch boundary has observed a CID', async () => {
    const f = await neverStartedFixture()
    expect(await f.boundary().proveNeverStarted()).toBeNull()
    expect(f.run).not.toHaveBeenCalled()
    expect(f.options.persistIdentity).not.toHaveBeenCalled()
  })

  it('does not replace the saved daemon with a different expected launch daemon', async () => {
    const f = await neverStartedFixture()
    f.daemon.ID = 'daemon:replacement'
    const foreign = createTaskDockerBoundary({
      ...f.options,
      persistIdentity: undefined,
      recoveryIdentity: f.identity,
      expectedDaemon: { ...f.identity.daemon, ID: f.daemon.ID }
    })
    expect(await foreign.proveNeverStarted()).toBeNull()
    expect(f.run).not.toHaveBeenCalled()
  })

  it('keeps the captured CID immutable through a same-name replacement and retry', async () => {
    const f = await neverStartedFixture()
    let inspections = 0
    f.before((spec) => {
      if (dockerArgs(spec)[0] === 'container' && ++inspections === 2) {
        f.container().Id = 'd'.repeat(64)
      }
    })
    expect(await f.cold.proveNeverStarted()).toBeNull()
    expect(await f.cold.proveNeverStarted()).toBeNull()
    expect(f.options.persistIdentity).not.toHaveBeenCalled()
  })

  it('refuses a late start between its two exact observations', async () => {
    const f = await neverStartedFixture()
    let inspections = 0
    f.before((spec) => {
      if (dockerArgs(spec)[0] === 'container' && ++inspections === 2) {
        f.start()
      }
    })
    expect(await f.cold.proveNeverStarted()).toBeNull()
    expect(f.container().State.Running).toBe(true)
    expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(false)
  })

  it('validates full policy again after capturing the original CID', async () => {
    const f = await neverStartedFixture()
    let inspections = 0
    f.before((spec) => {
      if (dockerArgs(spec)[0] === 'container' && ++inspections === 2) {
        f.container().HostConfig.Privileged = true
      }
    })
    expect(await f.cold.proveNeverStarted()).toBeNull()
  })

  it.each([
    'name',
    'labels',
    'image',
    'hostMount',
    'guestMount',
    'policy',
    'env',
    'tmpfs',
    'daemon'
  ])('refuses tampered original %s evidence', async (changed) => {
    const f = await neverStartedFixture()
    const container = f.container()
    if (changed === 'name') {
      container.Name = '/foreign'
    }
    if (changed === 'labels') {
      container.Config.Labels['io.hive.task.execution'] = 'foreign'
    }
    if (changed === 'image') {
      container.Image = `sha256:${'d'.repeat(64)}`
    }
    if (changed === 'hostMount') {
      container.HostConfig.Mounts[0]!.Source = f.root
    }
    if (changed === 'guestMount') {
      container.Mounts[0]!.RW = false
    }
    if (changed === 'policy') {
      container.HostConfig.Memory = 1
    }
    if (changed === 'env') {
      container.Config.Env.push('FOREIGN=1')
    }
    if (changed === 'tmpfs') {
      container.HostConfig.Tmpfs['/tmp'] = 'rw'
    }
    if (changed === 'daemon') {
      f.daemon.ID = 'daemon:foreign'
    }
    expect(await f.cold.proveNeverStarted()).toBeNull()
    expect(f.options.persistIdentity).not.toHaveBeenCalled()
    expect(
      f.run.mock.calls.every(([spec]) =>
        ['info', 'image', 'container'].includes(dockerArgs(spec)[0]!)
      )
    ).toBe(true)
  })

  it.each(['running', 'exited', 'paused', 'restarting', 'dead', 'pid', 'startedAt', 'finishedAt'])(
    'refuses a non-pristine %s container',
    async (state) => {
      const f = await neverStartedFixture()
      if (state === 'running' || state === 'exited') {
        f.start()
      }
      const observed = f.container().State
      if (state === 'exited') {
        observed.Status = 'exited'
        observed.Running = false
        observed.Pid = 0
        observed.FinishedAt = '2026-10-05T00:01:00Z'
      }
      if (state === 'paused') {
        observed.Paused = true
      }
      if (state === 'restarting') {
        observed.Restarting = true
      }
      if (state === 'dead') {
        observed.Dead = true
      }
      if (state === 'pid') {
        observed.Pid = 1
      }
      if (state === 'startedAt') {
        observed.StartedAt = '2026-10-05T00:00:00Z'
      }
      if (state === 'finishedAt') {
        observed.FinishedAt = '2026-10-05T00:01:00Z'
      }
      expect(await f.cold.proveNeverStarted()).toBeNull()
    }
  )

  it.each(['missing', 'imageUnavailable', 'truncated', 'timeout', 'failure'])(
    'keeps %s observation unknown without Docker mutations',
    async (failure) => {
      const f = await neverStartedFixture()
      const run = f.run.getMockImplementation()!
      f.run.mockImplementation(async (spec) => {
        const args = dockerArgs(spec)
        if (failure === 'imageUnavailable' && args[0] === 'image') {
          return result('', 1, 'image unavailable')
        }
        if (args[0] !== 'container') {
          return run(spec)
        }
        if (failure === 'missing') {
          return result('', 1, `Error: No such object: ${args[2]}`)
        }
        if (failure === 'failure') {
          throw new Error('synthetic inspection failure')
        }
        const found = await run(spec)
        return {
          ...found,
          outputTruncated: failure === 'truncated',
          timedOut: failure === 'timeout'
        }
      })
      expect(await f.cold.proveNeverStarted()).toBeNull()
      expect(f.options.persistIdentity).not.toHaveBeenCalled()
    }
  )
})

describe('durable original Docker boundary identity', () => {
  it('requires a persistence port and refuses a bare CID as cold authority', async () => {
    const f = await taskDockerFixture()
    const unbound = { ...f.options, persistIdentity: undefined, containerId: CID }
    expect(() => createTaskDockerBoundary(unbound)).toThrow('INVALID_REQUEST')
    expect(f.run).not.toHaveBeenCalled()
  })

  it('awaits pending persistence before create and exact CID persistence before returning a start', async () => {
    const f = await taskDockerFixture()
    const first = deferred(),
      second = deferred()
    f.options.persistIdentity.mockImplementation(async (identity) => {
      await (identity.containerId === null ? first.promise : second.promise)
    })
    let prepared = false
    const pending = f
      .boundary()
      .prepare()
      .then((value) => {
        prepared = true
        return value
      })
    await vi.waitFor(() => expect(f.options.persistIdentity).toHaveBeenCalledTimes(1))
    expect(f.options.persistIdentity.mock.calls[0]![0]).toMatchObject({
      daemon: f.daemon,
      containerId: null
    })
    expect(created(f)).toHaveLength(0)
    first.resolve()
    await vi.waitFor(() => expect(f.options.persistIdentity).toHaveBeenCalledTimes(2))
    expect(created(f)).toHaveLength(1)
    expect(prepared).toBe(false)
    expect(f.options.persistIdentity.mock.calls[1]![0]).toMatchObject({ containerId: CID })
    second.resolve()
    expect((await pending).launch.args.at(-1)).toBe(CID)
  })

  it.each(['pending', 'cid'])(
    'never returns a start after failed %s persistence',
    async (stage) => {
      const f = await taskDockerFixture()
      f.options.persistIdentity.mockImplementation(async (identity) => {
        if ((identity.containerId === null) === (stage === 'pending')) {
          throw new Error('disk failure')
        }
      })
      const boundary = f.boundary()
      await expect(boundary.prepare()).rejects.toThrow('disk failure')
      expect(created(f)).toHaveLength(stage === 'pending' ? 0 : 1)
      expect(await boundary.stop()).toBe(false)
      expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(false)
    }
  )

  it('rechecks revocation when a pending durable write returns', async () => {
    const f = await taskDockerFixture()
    const gate = deferred()
    f.options.persistIdentity.mockImplementation(async () => {
      await gate.promise
    })
    const pending = f.boundary().prepare()
    const rejected = expect(pending).rejects.toThrow('revoked')
    await vi.waitFor(() => expect(f.options.persistIdentity).toHaveBeenCalledTimes(1))
    f.revoke()
    gate.resolve()
    await rejected
    expect(created(f)).toHaveLength(0)
  })

  it.each(['pending', 'cid'])('rechecks daemon identity after the %s checkpoint', async (stage) => {
    const f = await taskDockerFixture()
    f.options.persistIdentity.mockImplementation(async (identity) => {
      if ((identity.containerId === null) === (stage === 'pending')) {
        f.daemon.ID = 'daemon:foreign'
      }
    })
    const boundary = f.boundary()
    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
    expect(created(f)).toHaveLength(stage === 'pending' ? 0 : 1)
    expect(await boundary.stop()).toBe(false)
  })

  it('restores immutable cleanup after workspace removal, config drift and authority revocation', async () => {
    const f = await taskDockerFixture()
    const prepared = await f.boundary().prepare()
    const identity = structuredClone(f.options.persistIdentity.mock.calls.at(-1)![0])
    f.start()
    await rename(
      f.options.record.workspace.executionPath,
      `${f.options.record.workspace.executionPath}-original`
    )
    await mkdir(prepared.launch.args[prepared.launch.args.indexOf('--config') + 1]!)
    f.revoke()
    const run = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'image' ? result('', 1, 'unavailable') : run(spec)
    )
    const cold = restore(f, identity)
    expect(await cold.inspect()).toBe('live')
    await expect(cold.prepare()).rejects.toThrow('FORBIDDEN')
    expect(await cold.stop()).toBe(true)
    expect(await cold.inspect()).toBe('exited')
    expect(created(f)).toHaveLength(1)
  })

  it('never repins a cold identity to a replacement daemon', async () => {
    const f = await taskDockerFixture()
    await f.boundary().prepare()
    const identity = f.options.persistIdentity.mock.calls.at(-1)![0]
    f.start()
    f.daemon.ID = 'daemon:replacement'
    const cold = restore(f, identity)
    expect(await cold.inspect()).toBe('unverifiable')
    expect(await cold.stop()).toBe(false)
    expect(f.container().State.Running).toBe(true)
    expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(false)
    f.daemon.ID = identity.daemon.ID
    expect(await cold.stop()).toBe(true)
  })

  it('can observe and stop the saved daemon after a version-only upgrade', async () => {
    const f = await taskDockerFixture()
    await f.boundary().prepare()
    const identity = f.options.persistIdentity.mock.calls.at(-1)![0]
    f.start()
    f.daemon.ServerVersion = '29.8.2'
    const cold = restore(f, identity)
    expect(await cold.inspect()).toBe('live')
    expect(await cold.stop()).toBe(true)
  })

  it('recovers an ambiguous create by saved name without image metadata or a new launch', async () => {
    const f = await taskDockerFixture()
    f.loseCreateReply()
    await f.boundary().prepare()
    const pendingIdentity = f.options.persistIdentity.mock.calls[0]![0]
    f.start()
    const run = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'image' ? result('', 1, 'unavailable') : run(spec)
    )
    const cold = restore(f, pendingIdentity)
    expect(await cold.inspect()).toBe('live')
    await expect(cold.prepare()).rejects.toThrow('FORBIDDEN')
    expect(await cold.stop()).toBe(true)
    expect(created(f)).toHaveLength(1)
  })

  it.each(['created', 'missing'])(
    'does not fabricate stopped proof for a %s original container',
    async (state) => {
      const f = await taskDockerFixture()
      await f.boundary().prepare()
      const identity = f.options.persistIdentity.mock.calls.at(-1)![0]
      if (state === 'missing') {
        const run = f.run.getMockImplementation()!
        f.run.mockImplementation(async (spec) =>
          dockerArgs(spec)[0] === 'container'
            ? result('', 1, `Error: No such object: ${dockerArgs(spec)[2]}`)
            : run(spec)
        )
      }
      const cold = restore(f, identity)
      expect(await cold.inspect()).toBe('unverifiable')
      expect(await cold.stop()).toBe(false)
      expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(false)
    }
  )

  it('snapshots the saved identity and refuses a foreign original CID', async () => {
    const f = await taskDockerFixture()
    await f.boundary().prepare()
    const identity = structuredClone(f.options.persistIdentity.mock.calls.at(-1)![0])
    f.start()
    const cold = restore(f, identity)
    identity.daemon.ID = 'daemon:foreign'
    identity.containerId = 'd'.repeat(64)
    expect(await cold.inspect()).toBe('live')
    const foreign = restore(f, { ...identity, daemon: { ...identity.daemon, ID: f.daemon.ID } })
    expect(await foreign.stop()).toBe(false)
    expect(f.container().State.Running).toBe(true)
    expect(await cold.stop()).toBe(true)
  })
})
