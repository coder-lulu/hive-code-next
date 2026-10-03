import { describe, expect, it, vi } from 'vitest'
import { scrcpyVideoRegistry, type ScrcpyVideoEvent } from './scrcpy-video-registry'

function frame(config: boolean): {
  config: boolean
  keyFrame: boolean
  pts: string
  bytes: ArrayBuffer
} {
  return { config, keyFrame: !config, pts: '0', bytes: new ArrayBuffer(2) }
}

describe('scrcpyVideoRegistry', () => {
  it('replays cached meta + config to late subscribers and stops cleanly', () => {
    const close = vi.fn()
    scrcpyVideoRegistry.register('dev', close)
    scrcpyVideoRegistry.pushMeta('dev', { codecId: 'h264', width: 1, height: 2 })
    scrcpyVideoRegistry.pushFrame('dev', frame(true))

    const events: ScrcpyVideoEvent['type'][] = []
    const unsubscribe = scrcpyVideoRegistry.subscribe('dev', (event) => events.push(event.type))
    expect(events).toEqual(['meta', 'frame']) // replayed cached meta + config

    scrcpyVideoRegistry.pushFrame('dev', frame(false))
    expect(events).toEqual(['meta', 'frame', 'frame'])

    unsubscribe()
    scrcpyVideoRegistry.pushFrame('dev', frame(false))
    expect(events).toEqual(['meta', 'frame', 'frame']) // no delivery after unsubscribe

    scrcpyVideoRegistry.stop('dev')
    expect(close).toHaveBeenCalledTimes(1)
    expect(scrcpyVideoRegistry.has('dev')).toBe(false)
  })

  it('ignores pushes for unknown devices', () => {
    expect(() =>
      scrcpyVideoRegistry.pushMeta('missing', { codecId: 'h264', width: 1, height: 1 })
    ).not.toThrow()
    const events: ScrcpyVideoEvent[] = []
    expect(
      scrcpyVideoRegistry.subscribe('missing', (event) => events.push(event))()
    ).toBeUndefined()
    expect(events).toEqual([{ type: 'error', message: 'Android video stream is unavailable.' }])
  })

  it('notifies subscribers about unexpected termination before closing once', () => {
    const close = vi.fn(() => scrcpyVideoRegistry.stop('failed'))
    const events: ScrcpyVideoEvent[] = []
    scrcpyVideoRegistry.register('failed', close)
    scrcpyVideoRegistry.subscribe('failed', (event) => events.push(event))

    scrcpyVideoRegistry.stop('failed', 'video socket closed')

    expect(events).toEqual([{ type: 'error', message: 'video socket closed' }])
    expect(close).toHaveBeenCalledTimes(1)
    expect(scrcpyVideoRegistry.has('failed')).toBe(false)
  })

  it('does not report intentional shutdown as a stream failure', () => {
    const events: ScrcpyVideoEvent[] = []
    scrcpyVideoRegistry.register('shutdown', () => {})
    scrcpyVideoRegistry.subscribe('shutdown', (event) => events.push(event))

    scrcpyVideoRegistry.stop('shutdown')

    expect(events).toEqual([])
  })

  it('replays the current GOP (keyframe + following deltas) to late subscribers', () => {
    scrcpyVideoRegistry.register('gop', () => {})
    const tag = (event: ScrcpyVideoEvent): string =>
      event.type === 'frame' ? `${event.frame.keyFrame ? 'K' : 'D'}${event.frame.pts}` : 'M'
    scrcpyVideoRegistry.pushFrame('gop', {
      config: false,
      keyFrame: true,
      pts: '1',
      bytes: new ArrayBuffer(2)
    })
    scrcpyVideoRegistry.pushFrame('gop', {
      config: false,
      keyFrame: false,
      pts: '2',
      bytes: new ArrayBuffer(2)
    })

    const seen: string[] = []
    scrcpyVideoRegistry.subscribe('gop', (event) => seen.push(tag(event)))()
    expect(seen).toEqual(['K1', 'D2'])

    // A new keyframe drops the prior GOP so replay always starts decodeable.
    scrcpyVideoRegistry.pushFrame('gop', {
      config: false,
      keyFrame: true,
      pts: '3',
      bytes: new ArrayBuffer(2)
    })
    const seen2: string[] = []
    scrcpyVideoRegistry.subscribe('gop', (event) => seen2.push(tag(event)))()
    expect(seen2).toEqual(['K3'])

    scrcpyVideoRegistry.stop('gop')
  })

  it('does not buffer deltas that arrive before the first keyframe', () => {
    scrcpyVideoRegistry.register('predelta', () => {})
    scrcpyVideoRegistry.pushFrame('predelta', {
      config: false,
      keyFrame: false,
      pts: '1',
      bytes: new ArrayBuffer(2)
    })

    const frames: string[] = []
    scrcpyVideoRegistry.subscribe('predelta', (event) => {
      if (event.type === 'frame') {
        frames.push(event.frame.pts)
      }
    })()
    expect(frames).toEqual([])
    scrcpyVideoRegistry.stop('predelta')
  })
})
