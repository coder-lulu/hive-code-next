import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AndroidCommandRunner } from './android-command-runner'

const nodeMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  spawn: vi.fn()
}))

vi.mock('node:child_process', () => ({ spawn: nodeMocks.spawn }))
vi.mock('node:net', () => ({ connect: nodeMocks.connect }))
vi.mock('../emulator-probe', () => ({ emulatorProbe: vi.fn(), emulatorProbeError: vi.fn() }))

import { ScrcpyStreamSession, type ScrcpyStreamCallbacks } from './scrcpy-stream-session'

type FakeSocket = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>
  setTimeout: ReturnType<typeof vi.fn>
}

function makeSocket(): FakeSocket {
  const socket = new EventEmitter() as FakeSocket
  socket.destroy = vi.fn()
  socket.setTimeout = vi.fn()
  return socket
}

function makeReadyPacket(): Buffer {
  const header = Buffer.alloc(65)
  const meta = Buffer.alloc(12)
  meta.write('h264', 0, 'ascii')
  meta.writeUInt32BE(1080, 4)
  meta.writeUInt32BE(2400, 8)
  return Buffer.concat([header, meta])
}

async function startSession() {
  const server = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }
  server.stdout = new EventEmitter()
  server.stderr = new EventEmitter()
  server.kill = vi.fn()
  const video = makeSocket()
  const control = makeSocket()
  nodeMocks.spawn.mockReturnValue(server)
  nodeMocks.connect.mockReturnValueOnce(video).mockReturnValueOnce(control)
  const runner = vi.fn(async (_binary: string, args: readonly string[]) => ({
    code: 0,
    stderr: '',
    stdout: args.includes('tcp:0') ? '40123' : ''
  })) as AndroidCommandRunner
  const callbacks: ScrcpyStreamCallbacks = {
    onMeta: vi.fn(),
    onFrame: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn()
  }
  const started = ScrcpyStreamSession.start(
    {
      runner,
      sdk: { adb: 'adb', avdmanager: 'avdmanager', emulator: 'emulator', sdkRoot: '/sdk' },
      serial: 'emulator-5554',
      localJarPath: '/tmp/scrcpy-server.jar'
    },
    callbacks
  )
  await vi.waitFor(() => expect(nodeMocks.connect).toHaveBeenCalledTimes(1))
  video.emit('data', makeReadyPacket())
  const session = await started
  return { callbacks, control, runner, server, session, video }
}

describe('ScrcpyStreamSession termination', () => {
  beforeEach(() => {
    nodeMocks.connect.mockReset()
    nodeMocks.spawn.mockReset()
  })

  it('reports a video socket close after startup as a terminal stream error', async () => {
    const { callbacks, server, video } = await startSession()

    video.emit('close')
    server.emit('exit', 1)

    expect(callbacks.onError).toHaveBeenCalledTimes(1)
    expect(callbacks.onError).toHaveBeenCalledWith('scrcpy video stream closed')
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  })

  it('reports a server exit after startup and removes the adb forward', async () => {
    const { callbacks, runner, server } = await startSession()

    server.emit('exit', 7)

    expect(callbacks.onError).toHaveBeenCalledWith('scrcpy server exited with code 7')
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
    await vi.waitFor(() =>
      expect(runner).toHaveBeenCalledWith(
        'adb',
        expect.arrayContaining(['forward', '--remove', 'tcp:40123'])
      )
    )
  })
})
