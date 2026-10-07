import { mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTaskDockerBoundary } from './task-docker-boundary'
import {
  CID,
  ENDPOINT,
  IMAGE,
  dockerArgs,
  result,
  taskDockerFixture as fixture
} from './task-docker-boundary.test-fixture'

describe('original task Docker boundary', () => {
  it('adopts exact Docker 29 interactive AttachStdin=true and StdinOnce=true metadata', async () => {
    const f = await fixture()
    f.before((spec) => {
      if (dockerArgs(spec)[0] === 'container' && f.container()) {
        f.container().Config.AttachStdin = true
        f.container().Config.StdinOnce = true
      }
    })
    await expect(f.boundary().prepare()).resolves.toMatchObject({ containerId: CID })
  })

  it.each(['AttachStdin', 'StdinOnce'])(
    'refuses false interactive metadata for %s',
    async (key) => {
      const f = await fixture()
      const boundary = f.boundary()
      await boundary.prepare()
      Object.assign(f.container().Config, { [key]: false })
      await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
    }
  )
  it('creates once under concurrency and returns an exact CID attachment with bounded hidden invocation', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    const [first, second] = await Promise.all([boundary.prepare(), boundary.prepare()])
    expect(first.containerId).toBe(CID)
    expect(second.containerId).toBe(CID)
    expect(first.launch).toMatchObject({
      command: process.execPath,
      args: expect.arrayContaining(['--host', ENDPOINT, 'start', '--attach', '--interactive', CID]),
      cwd: dirname(f.options.dockerPath),
      environmentMode: 'replace'
    })
    const specs = f.run.mock.calls.map(([spec]) => spec)
    expect(specs.filter((spec) => dockerArgs(spec)[0] === 'create')).toHaveLength(1)
    for (const spec of specs) {
      expect(spec.timeoutMs).toBeGreaterThan(0)
      expect(spec.timeoutMs).toBeLessThanOrEqual(30000)
      expect(spec.maxOutputBytes).toBeLessThanOrEqual(262144)
      expect(spec.env?.ORCA_BACKGROUND_LAUNCH).toBe('1')
    }
    const create = dockerArgs(specs.find((spec) => dockerArgs(spec)[0] === 'create')!)
    expect(create).toEqual(
      expect.arrayContaining([
        '--pull=never',
        '--read-only',
        '--network=none',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user=1000:1000',
        '--pids-limit=128',
        '--memory=512m',
        '--memory-swap=512m',
        '--cpus=1',
        '--entrypoint=/usr/local/bin/node',
        IMAGE,
        '/opt/hive/codex-worker.mjs'
      ])
    )
    expect(create.filter((arg) => arg === '--mount')).toHaveLength(1)
    expect(create).not.toContain('--privileged')
    expect(specs.some((spec) => dockerArgs(spec)[0] === 'start')).toBe(false)
  })

  it('recovers a lost create reply only by inspecting the original deterministic name', async () => {
    const f = await fixture()
    f.loseCreateReply()
    const prepared = await f.boundary().prepare()
    expect(prepared.containerId).toBe(CID)
    expect(f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'create')).toHaveLength(1)
    const targets = f.run.mock.calls
      .filter(([spec]) => dockerArgs(spec)[0] === 'container')
      .map(([spec]) => dockerArgs(spec)[2])
    expect(new Set(targets).size).toBe(1)
  })

  it('adopts a verified never-started container on reconstruction without another create', async () => {
    const f = await fixture()
    await f.boundary().prepare()
    await expect(f.boundary().prepare()).resolves.toMatchObject({ containerId: CID })
    expect(f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'create')).toHaveLength(1)
  })

  it('will not issue another start intent for an already running or previously exited container', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.start()
    await expect(boundary.prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(await boundary.inspect()).toBe('live')
    expect(await boundary.stop()).toBe(true)
    await expect(f.boundary().prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
  })

  it.each([
    'ReadonlyRootfs',
    'Privileged',
    'PidsLimit',
    'Memory',
    'NanoCpus',
    'NetworkMode',
    'PidMode'
  ])('refuses configuration drift in %s despite valid labels', async (key) => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    Object.assign(f.container().HostConfig, { [key]: key === 'ReadonlyRootfs' ? false : 'unsafe' })
    await expect(boundary.prepare()).rejects.toThrow('FORBIDDEN')
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(false)
  })

  it('rejects extra environment, commands and mounts independently of labels', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.container().Config.Env.push('OPENAI_API_KEY=synthetic-forbidden')
    expect(await boundary.inspect()).toBe('unverifiable')
    f.container().Config.Env.pop()
    f.container().Config.Cmd = ['/bin/sh']
    expect(await boundary.inspect()).toBe('unverifiable')
    f.container().Config.Cmd = ['/opt/hive/codex-worker.mjs']
    f.container().Mounts.push({
      Type: 'bind',
      Source: '/var/run/docker.sock',
      Destination: '/docker.sock',
      RW: true,
      Propagation: 'rprivate'
    })
    expect(await boundary.inspect()).toBe('unverifiable')
  })

  it.each(['LD_PRELOAD=/host/library', '__proto__=unsafe', 'NODE_VERSION=24.18.0\n'])(
    'rejects unapproved image default environment before creating: %j',
    async (item) => {
      const f = await fixture()
      if (item.startsWith('NODE_VERSION=')) {
        f.image.Config.Env[1] = item
      } else {
        f.image.Config.Env.push(item)
      }
      await expect(f.boundary().prepare()).rejects.toThrow('FORBIDDEN')
      expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
    }
  )

  it('accepts Docker 29 empty-array output with the exact scoped missing-container error', async () => {
    const f = await fixture()
    const originalRun = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) => {
      const reply = await originalRun(spec)
      return dockerArgs(spec)[0] === 'container' && reply.code === 1
        ? {
            ...reply,
            stdout: '[]\n',
            stderr: `Error response from daemon: No such container: ${dockerArgs(spec)[2]}\n`
          }
        : reply
    })
    await expect(f.boundary().prepare()).resolves.toMatchObject({ containerId: CID })
  })

  it.each(['arbitrary', 'signal', 'timeout', 'truncated'])(
    'rejects untrusted missing-container evidence: %s',
    async (kind) => {
      const f = await fixture()
      const originalRun = f.run.getMockImplementation()!
      f.run.mockImplementation(async (spec) =>
        dockerArgs(spec)[0] === 'container'
          ? {
              ...result(
                kind === 'arbitrary' ? '[{}]' : '[]',
                1,
                `Error response from daemon: No such container: ${dockerArgs(spec)[2]}`
              ),
              signal: kind === 'signal' ? 'SIGTERM' : null,
              timedOut: kind === 'timeout',
              outputTruncated: kind === 'truncated'
            }
          : originalRun(spec)
      )
      await expect(f.boundary().prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
      expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
    }
  )

  it('verifies the original exact CID and ownership labels on every read', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.container().Id = 'd'.repeat(64)
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(false)
    f.container().Id = CID
    const key = Object.keys(f.container().Config.Labels)[0]!
    f.container().Config.Labels[key] = 'other-owner'
    expect(await boundary.inspect()).toBe('unverifiable')
  })

  it('requires real post-kill Docker state and permits retry/join after a false proof', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.start()
    f.keepLive(true)
    expect(await boundary.stop()).toBe(false)
    f.keepLive(false)
    const [first, second] = await Promise.all([boundary.stop(), boundary.stop()])
    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'kill')).toHaveLength(2)
    expect(await boundary.inspect()).toBe('exited')
  })

  it.each(['Pid', 'Dead', 'Status'])(
    'does not accept a false stopped state (%s)',
    async (field) => {
      const f = await fixture()
      const boundary = f.boundary()
      await boundary.prepare()
      f.start()
      f.before((spec) => {
        if (dockerArgs(spec)[0] === 'container' && f.container().State.Status === 'exited') {
          Object.assign(f.container().State, {
            [field]: field === 'Dead' ? true : field === 'Pid' ? 999 : 'created'
          })
        }
      })
      expect(await boundary.stop()).toBe(false)
    }
  )

  it('never releases a merely created container which could still receive a late start', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    const prepared = await boundary.prepare()
    expect(await boundary.stop()).toBe(false)
    expect(() => prepared.assertCurrent()).toThrow()
    await expect(boundary.prepare()).rejects.toThrow()
    expect(f.container().State.Status).toBe('created')
    expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'rm')).toBe(false)
  })

  it('can stop the original running identity after revocation without permitting another start', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    const prepared = await boundary.prepare()
    f.start()
    f.revoke()
    expect(() => prepared.assertCurrent()).toThrow('revoked')
    await expect(boundary.prepare()).rejects.toThrow()
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(true)
    const kill = f.run.mock.calls.find(([spec]) => dockerArgs(spec)[0] === 'kill')![0]
    expect(dockerArgs(kill)).toEqual(['kill', '--signal=KILL', CID])
  })

  it('checks revocation after create and keeps the original identity available for cleanup', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    f.before((spec) => {
      if (dockerArgs(spec)[0] === 'create') {
        f.revoke()
      }
    })
    await expect(boundary.prepare()).rejects.toThrow('revoked')
    expect(f.container().State.Status).toBe('created')
    expect(await boundary.stop()).toBe(false)
  })

  it('refuses workspace replacement during a slow operation without launching', async () => {
    const f = await fixture()
    f.before(async (spec) => {
      if (dockerArgs(spec)[0] === 'create') {
        const path = f.options.record.workspace.executionPath
        await rename(path, `${path}-original`)
        await mkdir(path)
      }
    })
    await expect(f.boundary().prepare()).rejects.toThrow('FORBIDDEN')
    expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'start')).toBe(false)
  })

  it.each(['relative/path', '/workspace,bad', '/workspace\nother', '/workspace\0other'])(
    'refuses malformed mount paths before invoking Docker: %j',
    async (executionPath) => {
      const f = await fixture()
      f.options.record.workspace.executionPath = executionPath
      expect(() => f.boundary()).toThrow()
      expect(f.run).not.toHaveBeenCalled()
    }
  )

  it('rejects an image tag and relative Docker executable before invoking anything', async () => {
    const f = await fixture()
    expect(() => createTaskDockerBoundary({ ...f.options, imageId: 'node:latest' })).toThrow()
    expect(() => createTaskDockerBoundary({ ...f.options, dockerPath: 'docker' })).toThrow()
    expect(f.run).not.toHaveBeenCalled()
  })

  it('reports unreachable, malformed and clipped inspect replies as unverifiable, never exited', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    const originalRun = f.run.getMockImplementation()!
    let reply = result('', 1, 'daemon unreachable')
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'container' ? reply : originalRun(spec)
    )
    expect(await boundary.inspect()).toBe('unverifiable')
    reply = result('{}')
    expect(await boundary.inspect()).toBe('unverifiable')
    reply = { ...result(JSON.stringify([f.container()])), outputTruncated: true }
    expect(await boundary.inspect()).toBe('unverifiable')
  })

  it('pins a local daemon and drops parent Docker context and provider environment', async () => {
    vi.stubEnv('DOCKER_HOST', 'tcp://remote.example:2375')
    vi.stubEnv('DOCKER_CONTEXT', 'unowned-context')
    try {
      const f = await fixture()
      const prepared = await f.boundary().prepare()
      for (const [spec] of f.run.mock.calls) {
        expect(spec.args?.slice(0, 4)).toEqual([
          '--config',
          expect.stringContaining('-docker-empty'),
          '--host',
          ENDPOINT
        ])
        expect(Object.keys(spec.env!)).toEqual(expect.arrayContaining(['ORCA_BACKGROUND_LAUNCH']))
        expect(spec.env?.DOCKER_HOST).toBeUndefined()
        expect(spec.env?.DOCKER_CONTEXT).toBeUndefined()
        expect(spec.env?.HOME).toBeUndefined()
      }
      expect(prepared.launch.environmentMode).toBe('replace')
      expect(prepared.launch.env.DOCKER_HOST).toBeUndefined()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    'tcp://127.0.0.1:2375',
    'ssh://localhost',
    'unix:///remote/proxy.sock',
    'npipe:////./pipe/unowned'
  ])('refuses an unqualified endpoint %s', async (endpoint) => {
    const f = await fixture()
    expect(() => createTaskDockerBoundary({ ...f.options, endpoint })).toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(f.run).not.toHaveBeenCalled()
  })

  it('refuses daemon identity drift and a non-Linux daemon without creating or killing', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    f.daemon.ID = 'daemon:replacement'
    expect(await boundary.inspect()).toBe('unverifiable')
    expect(await boundary.stop()).toBe(false)
    expect(f.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'kill')).toBe(false)
    const g = await fixture()
    g.daemon.OSType = 'windows'
    await expect(g.boundary().prepare()).rejects.toThrow('FORBIDDEN')
    expect(g.run.mock.calls.some(([spec]) => dockerArgs(spec)[0] === 'create')).toBe(false)
  })

  it('does not retry an ambiguous create which is still unobservable', async () => {
    const f = await fixture()
    const originalRun = f.run.getMockImplementation()!
    f.run.mockImplementation(async (spec) =>
      dockerArgs(spec)[0] === 'create'
        ? { ...result(''), timedOut: true, code: null }
        : originalRun(spec)
    )
    const boundary = f.boundary()
    await expect(boundary.prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
    await expect(boundary.prepare()).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.run.mock.calls.filter(([spec]) => dockerArgs(spec)[0] === 'create')).toHaveLength(1)
  })

  it('refuses attached networks despite the unchanged network-mode bit', async () => {
    const f = await fixture()
    const boundary = f.boundary()
    await boundary.prepare()
    Object.assign(f.container().NetworkSettings.Networks, { bridge: {} })
    expect(await boundary.inspect()).toBe('unverifiable')
  })
})
