// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmulatorScreenStreamContent } from './emulator-screen-stream-content'

type FrameListener = (data: { streamId: string; bytes: ArrayBuffer }) => void
type ErrorListener = (data: { streamId: string; message: string }) => void
type DecodedFrame = {
  close: () => void
  displayHeight: number
  displayWidth: number
}

let container: HTMLDivElement
let root: Root
let frameListeners: FrameListener[]
let errorListeners: ErrorListener[]
let startFrameStream: ReturnType<typeof vi.fn>
let stopFrameStream: ReturnType<typeof vi.fn>
let originalCreateObjectURL: typeof URL.createObjectURL | undefined
let originalRevokeObjectURL: typeof URL.revokeObjectURL | undefined
let originalCanvasGetContext: typeof HTMLCanvasElement.prototype.getContext
let originalEncodedVideoChunk: typeof globalThis.EncodedVideoChunk | undefined
let originalVideoDecoder: typeof globalThis.VideoDecoder | undefined
let decoderOutput: ((frame: DecodedFrame) => void) | null
let objectUrlCounter: number
let streamCounter: number

beforeEach(() => {
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  frameListeners = []
  errorListeners = []
  objectUrlCounter = 0
  streamCounter = 0
  decoderOutput = null
  startFrameStream = vi.fn(async () => ({ streamId: `stream-${++streamCounter}` }))
  stopFrameStream = vi.fn(async () => {})
  originalCreateObjectURL = URL.createObjectURL
  originalRevokeObjectURL = URL.revokeObjectURL
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:emulator-frame-${++objectUrlCounter}`)
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  })
  originalCanvasGetContext = HTMLCanvasElement.prototype.getContext
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: vi.fn(() => ({ clearRect: vi.fn(), drawImage: vi.fn() }))
  })
  originalEncodedVideoChunk = globalThis.EncodedVideoChunk
  originalVideoDecoder = globalThis.VideoDecoder
  class FakeVideoDecoder {
    state = 'unconfigured'

    constructor(init: { output: (frame: DecodedFrame) => void }) {
      decoderOutput = init.output
    }

    close(): void {
      this.state = 'closed'
    }

    configure(): void {
      this.state = 'configured'
    }

    decode(): void {}
  }
  Object.defineProperty(globalThis, 'EncodedVideoChunk', {
    configurable: true,
    value: class FakeEncodedVideoChunk {}
  })
  Object.defineProperty(globalThis, 'VideoDecoder', {
    configurable: true,
    value: FakeVideoDecoder
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      emulator: {
        startFrameStream,
        stopFrameStream,
        onFrameStreamFrame: (listener: FrameListener) => {
          frameListeners.push(listener)
          return () => {
            frameListeners = frameListeners.filter((current) => current !== listener)
          }
        },
        onFrameStreamError: (listener: ErrorListener) => {
          errorListeners.push(listener)
          return () => {
            errorListeners = errorListeners.filter((current) => current !== listener)
          }
        },
        onVideoStreamFrame: () => vi.fn(),
        onVideoStreamMeta: () => vi.fn(),
        startVideoStream: vi.fn(async ({ streamId }: { streamId: string }) => ({ streamId })),
        stopVideoStream: vi.fn(async () => {})
      }
    }
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectURL
    })
  } else {
    delete (URL as Partial<typeof URL>).createObjectURL
  }
  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectURL
    })
  } else {
    delete (URL as Partial<typeof URL>).revokeObjectURL
  }
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: originalCanvasGetContext
  })
  if (originalEncodedVideoChunk) {
    Object.defineProperty(globalThis, 'EncodedVideoChunk', {
      configurable: true,
      value: originalEncodedVideoChunk
    })
  } else {
    delete (globalThis as { EncodedVideoChunk?: unknown }).EncodedVideoChunk
  }
  if (originalVideoDecoder) {
    Object.defineProperty(globalThis, 'VideoDecoder', {
      configurable: true,
      value: originalVideoDecoder
    })
  } else {
    delete (globalThis as { VideoDecoder?: unknown }).VideoDecoder
  }
  delete (window as { api?: unknown }).api
  vi.restoreAllMocks()
})

async function renderStream(
  streamKey = 'abc',
  props?: { screenAspectRatio?: number; streamRotation?: -90 | 0 | 90 }
): Promise<void> {
  await act(async () => {
    root.render(
      <EmulatorScreenStreamContent
        loading={false}
        onStreamError={vi.fn()}
        onStreamSize={vi.fn()}
        previewUrl="http://127.0.0.1:3100/stream.mjpeg"
        screenAspectRatio={props?.screenAspectRatio}
        showStream={true}
        streamError={false}
        streamKey={streamKey}
        streamRotation={props?.streamRotation}
      />
    )
  })
}

describe('EmulatorScreenStreamContent', () => {
  it('names emulator startup before a session exposes a display stream', async () => {
    await act(async () => {
      root.render(
        <EmulatorScreenStreamContent
          loading={true}
          onStreamError={vi.fn()}
          onStreamSize={vi.fn()}
          showStream={false}
          streamError={false}
        />
      )
    })

    expect(container.textContent).toContain('Starting emulator…')
    expect(container.textContent).not.toContain('Connecting display…')
  })

  it('renders IPC-delivered frames as blob URLs instead of loading the MJPEG URL directly', async () => {
    await renderStream()

    expect(startFrameStream).toHaveBeenCalledWith({
      streamUrl: 'http://127.0.0.1:3100/stream.mjpeg',
      streamKey: 'abc'
    })
    expect(container.querySelector('img')).toBeNull()

    await act(async () => {
      frameListeners[0]?.({ streamId: 'stream-1', bytes: new Uint8Array([1, 2, 3]).buffer })
    })

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('blob:emulator-frame-1')
    expect(img?.className).toContain('object-contain')
    expect(img?.className).not.toContain('object-fill')
  })

  it('rotates mismatched stream media without stretching it', async () => {
    await renderStream('abc', { screenAspectRatio: 844 / 390, streamRotation: 90 })

    await act(async () => {
      frameListeners[0]?.({ streamId: 'stream-1', bytes: new Uint8Array([1, 2, 3]).buffer })
    })

    const img = container.querySelector('img')
    expect(img?.className).toContain('object-contain')
    expect(img?.className).toContain('absolute')
    expect(img?.className).not.toContain('object-fill')
    expect(img?.style.transform).toBe('translate(-50%, -50%) rotate(90deg)')
    expect(img?.style.width).toBe(`${100 / (844 / 390)}%`)
    expect(img?.style.height).toBe(`${100 * (844 / 390)}%`)
  })

  it('clears the previous frame while a new stream key is connecting', async () => {
    await renderStream('a')

    await act(async () => {
      frameListeners[0]?.({ streamId: 'stream-1', bytes: new Uint8Array([1, 2, 3]).buffer })
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:emulator-frame-1')

    await renderStream('b')

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('Connecting display…')
    expect(stopFrameStream).toHaveBeenCalledWith({ streamId: 'stream-1' })

    await act(async () => {
      frameListeners[0]?.({ streamId: 'stream-2', bytes: new Uint8Array([4, 5, 6]).buffer })
    })

    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:emulator-frame-2')
  })

  it('shows display connection progress until the first Android video frame is painted', async () => {
    await act(async () => {
      root.render(
        <EmulatorScreenStreamContent
          loading={false}
          onStreamError={vi.fn()}
          onStreamSize={vi.fn()}
          previewUrl="scrcpy://emulator-5554"
          showStream={true}
          streamError={false}
          streamKey="android-a"
        />
      )
    })

    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(canvas?.getAttribute('aria-hidden')).toBe('true')
    expect(container.textContent).toContain('Connecting display…')

    await act(async () => {
      decoderOutput?.({ close: vi.fn(), displayHeight: 2400, displayWidth: 1080 })
    })

    expect(canvas?.getAttribute('aria-hidden')).toBe('false')
    expect(container.textContent).not.toContain('Connecting display…')
  })
})
