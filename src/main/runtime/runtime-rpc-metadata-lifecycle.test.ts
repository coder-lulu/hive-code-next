import './rpc/unused-default-rpc-methods.test-fixture'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import * as runtimeMetadataModule from './runtime-metadata'
import { readRuntimeMetadata, writeRuntimeMetadata } from './runtime-metadata'
import { createRuntimeTransportMetadata } from './runtime-rpc/runtime-rpc-socket-metadata'
import { OrcaRuntimeRpcServer } from './runtime-rpc'
import type { DeviceRegistry } from './device-registry'
import type { RuntimeMetadata } from '../../shared/runtime-bootstrap'
import { UnixSocketTransport } from './rpc/unix-socket-transport'

vi.mock('../git/worktree', () => {
  const worktrees = [
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/foo',
      isBare: false,
      isMainWorktree: false
    }
  ]
  return {
    listWorktrees: vi.fn().mockResolvedValue(worktrees),
    listWorktreesStrict: vi.fn().mockResolvedValue(worktrees)
  }
})

describe('OrcaRuntimeRpcServer', () => {
  it('writes runtime metadata with transport details when started', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({ methods: [], runtime, userDataPath })

    await server.start()

    const metadata = readRuntimeMetadata(userDataPath)
    expect(metadata?.runtimeId).toBe(runtime.getRuntimeId())
    expect(metadata?.authToken).toBeTruthy()
    expect(metadata?.transports?.[0]?.endpoint).toBeTruthy()
    expect(metadata?.transports).toEqual(server['transports'])

    await server.stop()
    expect(readRuntimeMetadata(userDataPath)).toMatchObject({
      runtimeId: runtime.getRuntimeId()
    })
  })

  it('reclaims runtime metadata clobbered by a second instance that has since died', async () => {
    // A second instance can replace metadata then exit; reclaim it so CLI finds this still-serving runtime (#7848).
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({ methods: [], runtime, userDataPath })
    await server.start()
    const published = readRuntimeMetadata(userDataPath)

    writeRuntimeMetadata(userDataPath, {
      runtimeId: 'rt_second_instance',
      pid: 99999999,
      transports: [{ kind: 'unix', endpoint: join(userDataPath, 'o-99999999-rt2.sock') }],
      authToken: 'second-instance-token',
      startedAt: 1
    })
    await server.checkRuntimeMetadataOwnership()

    expect(readRuntimeMetadata(userDataPath)).toEqual(published)

    await server.stop()
  })

  it('leaves runtime metadata owned by a live sibling runtime untouched', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    // Use a synthetic owned pid and process.pid as live sibling; Windows never assigns pid 1.
    const server = new OrcaRuntimeRpcServer({
      methods: [],
      runtime: new OrcaRuntimeService(),
      userDataPath,
      pid: 4242
    })
    await server.start()

    writeRuntimeMetadata(userDataPath, {
      runtimeId: 'rt_live_sibling',
      pid: process.pid,
      transports: [{ kind: 'unix', endpoint: join(userDataPath, `o-${process.pid}-rt2.sock`) }],
      authToken: 'sibling-token',
      startedAt: 1
    })
    await server.checkRuntimeMetadataOwnership()

    expect(readRuntimeMetadata(userDataPath)).toMatchObject({ runtimeId: 'rt_live_sibling' })

    await server.stop()
  })

  it('stops reclaiming runtime metadata after the server is stopped', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const server = new OrcaRuntimeRpcServer({
      methods: [],
      runtime: new OrcaRuntimeService(),
      userDataPath
    })
    await server.start()
    const watch = server['metadataOwnershipWatch']
    if (!watch) {
      throw new Error('start() must arm the metadata ownership watch')
    }
    // Assert timer cancellation too; republish guard alone masks leaked intervals.
    const watchStop = vi.spyOn(watch, 'stop')
    await server.stop()

    writeRuntimeMetadata(userDataPath, {
      runtimeId: 'rt_second_instance',
      pid: 99999999,
      transports: [],
      authToken: 'second-instance-token',
      startedAt: 1
    })
    await server.checkRuntimeMetadataOwnership()

    expect(watchStop).toHaveBeenCalledTimes(1)
    expect(server['metadataOwnershipWatch']).toBeNull()
    expect(readRuntimeMetadata(userDataPath)).toMatchObject({ runtimeId: 'rt_second_instance' })
  })

  it('drops a republish from an ownership read that lands after the server stopped', async () => {
    // In-flight async reads can outlive stop; activeTransports must prevent late republish.
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({ methods: [], runtime, userDataPath, pid: 1001 })
    await server.start()

    let releaseRead: (record: RuntimeMetadata | null) => void = () => {}
    vi.spyOn(runtimeMetadataModule, 'readRuntimeMetadataAsync').mockImplementationOnce(
      () =>
        new Promise<RuntimeMetadata | null>((resolve) => {
          releaseRead = resolve
        })
    )
    const heldCheck = server.checkRuntimeMetadataOwnership()

    await server.stop()
    writeRuntimeMetadata(userDataPath, {
      runtimeId: 'rt_second_instance',
      pid: 99999999,
      transports: [],
      authToken: 'second-instance-token',
      startedAt: 1
    })
    // A missing record is the most reclaimable verdict there is, so an unguarded
    // resume would rewrite the file the second instance just published.
    releaseRead(null)
    await heldCheck

    expect(readRuntimeMetadata(userDataPath)).toMatchObject({ runtimeId: 'rt_second_instance' })
  })

  it('flushes a lastSeen refresh scheduled while transports stop', async () => {
    const server = new OrcaRuntimeRpcServer({
      methods: [],
      runtime: new OrcaRuntimeService(),
      userDataPath: mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-')),
      enableWebSocket: false
    })
    let pending = false
    const timeline: string[] = []
    server['deviceRegistry'] = {
      flushPendingLastSeen: vi.fn(() => {
        timeline.push(pending ? 'flush-pending' : 'flush-empty')
        pending = false
      })
    } as unknown as DeviceRegistry
    let finishSecondStop: () => void = () => {}
    const secondStop = new Promise<void>((resolve) => {
      finishSecondStop = resolve
    })
    server['activeTransports'] = [
      {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {
          timeline.push('failed-transport-stop')
          throw new Error('transport stop failed')
        })
      },
      {
        start: vi.fn(async () => {}),
        stop: vi.fn(async () => {
          timeline.push('second-transport-started')
          await secondStop
          timeline.push('second-transport-stopped')
          pending = true
        })
      }
    ]

    const stopping = server.stop()
    await vi.waitFor(() => expect(timeline).toContain('second-transport-started'))
    expect(timeline).not.toContain('flush-empty')
    finishSecondStop()
    await expect(stopping).rejects.toThrow('transport stop failed')

    expect(timeline).toEqual([
      'failed-transport-stop',
      'second-transport-started',
      'second-transport-stopped',
      'flush-pending'
    ])
    expect(pending).toBe(false)
  })

  it('closes the socket if metadata publication fails during startup', async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), 'orca-runtime-rpc-'))
    const runtime = new OrcaRuntimeService()
    const server = new OrcaRuntimeRpcServer({ methods: [], runtime, userDataPath })
    const writeMetadataSpy = vi
      .spyOn(runtimeMetadataModule, 'writeRuntimeMetadataAsync')
      .mockImplementationOnce(() => {
        throw new Error('write failed')
      })
    const endpoint = createRuntimeTransportMetadata(
      userDataPath,
      process.pid,
      process.platform,
      runtime.getRuntimeId()
    ).endpoint

    await expect(server.start()).rejects.toThrow('write failed')
    expect(readRuntimeMetadata(userDataPath)).toBeNull()
    expect(existsSync(endpoint)).toBe(false)
    expect(server['transports']).toEqual([])
    expect(server['activeTransports']).toEqual([])

    writeMetadataSpy.mockRestore()
  })
  it.each(['pairing', 'metadata'] as const)(
    'waits for pending %s startup before stopping all transports',
    async (stage) => {
      const server = new OrcaRuntimeRpcServer({
        runtime: new OrcaRuntimeService(),
        userDataPath: mkdtempSync(join(tmpdir(), 'orca-runtime-start-stop-')),
        enableWebSocket: stage === 'pairing'
      })
      let release!: () => void
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered = false
      const spy =
        stage === 'pairing'
          ? vi
              .spyOn(
                server as unknown as { initializePairingIdentity: () => Promise<unknown> },
                'initializePairingIdentity'
              )
              .mockImplementationOnce(async () => {
                entered = true
                await blocked
                return { ok: false, failure: {} }
              })
          : vi
              .spyOn(runtimeMetadataModule, 'writeRuntimeMetadataAsync')
              .mockImplementationOnce(async () => {
                entered = true
                await blocked
              })
      const starting = server.start()
      const socketStop = vi.spyOn(UnixSocketTransport.prototype, 'stop')
      await vi.waitFor(() => expect(entered).toBe(true))
      let stopped = false
      const stopping = server.stop().then(() => {
        stopped = true
      })
      await Promise.resolve()
      expect(stopped).toBe(false)
      release()
      await Promise.all([starting, stopping])
      expect(server['activeTransports']).toEqual([])
      expect(server['transports']).toEqual([])
      expect(server['metadataOwnershipWatch']).toBeNull()
      expect(socketStop).toHaveBeenCalledTimes(1)
      socketStop.mockRestore()
      spy.mockRestore()
    }
  )
})
