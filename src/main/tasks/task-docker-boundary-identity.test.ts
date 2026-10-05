import { mkdir, rename } from 'node:fs/promises'
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
