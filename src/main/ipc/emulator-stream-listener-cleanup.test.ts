import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the ipcMain handlers the modules register so tests can invoke them
// directly with a fake WebContents owner.
const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
const videoRegistryMock = vi.hoisted(() => ({
  subscriber: undefined as ((event: { type: string; message?: string }) => void) | undefined,
  unsubscribe: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, listener)
    }
  },
  // Any non-null return marks the sender as a real BrowserWindow renderer.
  BrowserWindow: { fromWebContents: () => ({}) }
}))

vi.mock('../emulator/mjpeg-frame-stream', () => ({
  MjpegFrameStream: class {
    start(): void {}
    stop(): void {}
  }
}))

vi.mock('../emulator/scrcpy-video-registry', () => ({
  scrcpyVideoRegistry: {
    subscribe: (
      _deviceId: string,
      subscriber: (event: { type: string; message?: string }) => void
    ) => {
      videoRegistryMock.subscriber = subscriber
      return videoRegistryMock.unsubscribe
    }
  }
}))

vi.mock('../emulator/emulator-probe', () => ({ emulatorProbe: () => {} }))

import { registerEmulatorFrameStreamHandlers } from './emulator-frame-stream'
import { registerEmulatorVideoStreamHandlers } from './emulator-video-stream'

/** A fake main-window WebContents: a real EventEmitter plus the members the
 * stream handlers touch, so we can assert on its real `destroyed` listeners. */
function makeOwner(): EventEmitter & {
  isDestroyed: () => boolean
  send: (...args: unknown[]) => void
} {
  const owner = new EventEmitter() as EventEmitter & {
    isDestroyed: () => boolean
    send: (...args: unknown[]) => void
  }
  owner.isDestroyed = () => false
  owner.send = () => {}
  return owner
}

beforeEach(() => {
  handlers.clear()
  videoRegistryMock.subscriber = undefined
  videoRegistryMock.unsubscribe.mockReset()
})

describe('emulator frame stream listener cleanup', () => {
  it('removes the destroyed listener on explicit stop and does not accumulate across cycles', () => {
    registerEmulatorFrameStreamHandlers()
    const start = handlers.get('emulator:frameStreamStart')!
    const stop = handlers.get('emulator:frameStreamStop')!
    const owner = makeOwner()
    const event = { sender: owner }

    // 15 show/hide cycles: without the fix this would leave 15 destroyed
    // listeners and trip Node's MaxListenersExceededWarning (default 10).
    for (let i = 0; i < 15; i++) {
      const { streamId } = start(event, { streamUrl: 'http://127.0.0.1:0/stream' }) as {
        streamId: string
      }
      expect(owner.listenerCount('destroyed')).toBe(1)
      stop(event, { streamId })
      expect(owner.listenerCount('destroyed')).toBe(0)
    }
  })
})

describe('emulator video stream listener cleanup', () => {
  it('removes the destroyed listener on explicit stop and does not accumulate across cycles', () => {
    registerEmulatorVideoStreamHandlers()
    const start = handlers.get('emulator:videoStreamStart')!
    const stop = handlers.get('emulator:videoStreamStop')!
    const owner = makeOwner()
    const event = { sender: owner }

    for (let i = 0; i < 15; i++) {
      const { streamId } = start(event, { deviceId: 'emulator-5554' }) as { streamId: string }
      expect(owner.listenerCount('destroyed')).toBe(1)
      stop(event, { streamId })
      expect(owner.listenerCount('destroyed')).toBe(0)
    }
  })

  it('forwards an unexpected scrcpy termination to its renderer subscriber', async () => {
    registerEmulatorVideoStreamHandlers()
    const start = handlers.get('emulator:videoStreamStart')!
    const owner = makeOwner()
    const send = vi.spyOn(owner, 'send')
    const { streamId } = start(
      { sender: owner },
      { deviceId: 'emulator-5554', streamId: 'video-1' }
    ) as { streamId: string }

    await new Promise((resolve) => setTimeout(resolve, 0))
    videoRegistryMock.subscriber?.({ type: 'error', message: 'scrcpy video stream closed' })

    expect(send).toHaveBeenCalledWith('emulator:videoStreamError', {
      streamId,
      deviceId: 'emulator-5554',
      message: 'scrcpy video stream closed'
    })
    expect(videoRegistryMock.unsubscribe).toHaveBeenCalledTimes(1)
    expect(owner.listenerCount('destroyed')).toBe(0)
  })
})
