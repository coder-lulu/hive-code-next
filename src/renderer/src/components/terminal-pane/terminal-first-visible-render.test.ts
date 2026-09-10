import { afterEach, expect, it, vi } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'
import { waitForTerminalVisibleRender } from './terminal-first-visible-render'

afterEach(() => vi.unstubAllGlobals())

it('waits for rendered panes and a following frame, and cancels stale readiness', () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const listeners: (() => void)[] = []
  const panes = [1, 2].map((id) => ({
    id,
    container: { getBoundingClientRect: () => ({ width: 100, height: 100 }) },
    terminal: {
      rows: 24,
      refresh: vi.fn(),
      onRender: (listener: () => void) => {
        listeners.push(listener)
        return { dispose: vi.fn() }
      }
    }
  })) as unknown as ManagedPane[]
  const ready = vi.fn()
  const cancel = waitForTerminalVisibleRender(panes, ready)
  expect(ready).not.toHaveBeenCalled()
  listeners[0]()
  frames.shift()!(0)
  expect(ready).not.toHaveBeenCalled()
  listeners[1]()
  expect(ready).not.toHaveBeenCalled()
  frames.shift()!(16)
  expect(ready).toHaveBeenCalledTimes(1)
  cancel()
  const staleReady = vi.fn()
  const cancelStale = waitForTerminalVisibleRender(panes, staleReady)
  listeners[2]()
  listeners[3]()
  cancelStale()
  frames.shift()!(32)
  expect(staleReady).not.toHaveBeenCalled()
})
