import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTaskDockerBoundary } from './task-docker-boundary'
import { CID, dockerArgs, result, taskDockerFixture } from './task-docker-boundary.test-fixture'

describe('cleanup of the original task Docker identity', () => {
  it.each(['missing', 'replaced'])(
    'stops the original live container after the launch workspace becomes %s',
    async (mode) => {
      const f = await taskDockerFixture()
      const boundary = f.boundary()
      const prepared = await boundary.prepare()
      f.start()
      const workspace = f.options.record.workspace.executionPath
      await rename(workspace, `${workspace}-original`)
      if (mode === 'replaced') {
        await mkdir(workspace)
      }

      expect(() => prepared.assertCurrent()).toThrow('FORBIDDEN')
      expect(await boundary.inspect()).toBe('unverifiable')
      expect(await boundary.stop()).toBe(true)
      const kill = f.run.mock.calls.find(([spec]) => dockerArgs(spec)[0] === 'kill')![0]
      expect(dockerArgs(kill)).toEqual(['kill', '--signal=KILL', CID])
      expect(kill.cwd).toBe(dirname(f.options.dockerPath))
      expect(kill.args?.slice(0, 2)).toEqual(['--config', f.options.dockerPath])
      expect(await boundary.inspect()).toBe('exited')
    }
  )

  it('stops the original live container when the launch config sibling is occupied', async () => {
    const f = await taskDockerFixture()
    const boundary = f.boundary()
    const prepared = await boundary.prepare()
    f.start()
    const config = prepared.launch.args[prepared.launch.args.indexOf('--config') + 1]!
    await mkdir(config)

    expect(() => prepared.assertCurrent()).toThrow('FORBIDDEN')
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(true)
    for (const [spec] of f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'kill')) {
      expect(spec.args?.slice(0, 2)).toEqual(['--config', f.options.dockerPath])
    }
  })

  it('terminates an owned container with changed limits while launch admission stays strict', async () => {
    const f = await taskDockerFixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.start()
    f.container().HostConfig.Memory = 268435456

    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(true)
    expect(f.container().State.Pid).toBe(0)
  })

  it('cleans up a recorded original CID without rereading image metadata', async () => {
    const f = await taskDockerFixture()
    await f.boundary().prepare()
    f.start()
    const run = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'image' ? result('', 1, 'image metadata unavailable') : run(spec)
    )
    const before = f.run.mock.calls.length
    const boundary = createTaskDockerBoundary({ ...f.options, containerId: CID })

    expect(await boundary.stop()).toBe(true)
    expect(f.run.mock.calls.slice(before).some(([spec]) => dockerArgs(spec)[0] === 'image')).toBe(
      false
    )
  })

  it('can stop on a newer daemon version with the same original daemon ID', async () => {
    const f = await taskDockerFixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.start()
    f.daemon.ServerVersion = '29.8.2'

    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(true)
  })

  it.each(['cid', 'labels', 'image', 'mount', 'daemon'])(
    'never kills an identity with mismatched original %s',
    async (changed) => {
      const f = await taskDockerFixture()
      const boundary = f.boundary()
      await boundary.prepare()
      f.start()
      if (changed === 'cid') {
        f.container().Id = 'd'.repeat(64)
      }
      if (changed === 'labels') {
        f.container().Config.Labels['io.hive.task.execution'] = 'foreign'
      }
      if (changed === 'image') {
        f.container().Image = `sha256:${'d'.repeat(64)}`
      }
      if (changed === 'mount') {
        f.container().Mounts[0]!.Source = dirname(f.root)
      }
      if (changed === 'daemon') {
        f.daemon.ID = 'foreign-daemon'
      }

      const before = f.run.mock.calls.length
      expect(await boundary.stop()).toBe(false)
      expect(f.run.mock.calls.slice(before).some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(
        false
      )
      expect(f.container().State.Running).toBe(true)
    }
  )

  it('holds the original writer through daemon loss and retries it after the same daemon returns', async () => {
    const f = await taskDockerFixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.start()
    const run = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'info' ? result('', 1, 'daemon unavailable') : run(spec)
    )
    const before = f.run.mock.calls.length
    expect(await boundary.stop()).toBe(false)
    expect(f.run.mock.calls.slice(before).some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(
      false
    )
    f.run.mockImplementation(run)
    expect(await boundary.stop()).toBe(true)
  })
})
