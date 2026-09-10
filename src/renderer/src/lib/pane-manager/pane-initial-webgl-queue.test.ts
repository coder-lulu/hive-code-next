import { afterEach, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'
import {
  cancelInitialPaneWebgl,
  isInitialPaneWebglPending,
  queueInitialPaneWebgl
} from './pane-initial-webgl-queue'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('initializes one pane per paint opportunity and cancels disposed panes', () => {
  vi.useFakeTimers()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const panes = [{}, {}, {}] as ManagedPaneInternal[]
  const attach = vi.fn()
  panes.forEach((pane) => queueInitialPaneWebgl(pane, () => attach(pane)))
  expect(attach).not.toHaveBeenCalled()
  frames.shift()!(0)
  expect(attach).not.toHaveBeenCalled()
  vi.runOnlyPendingTimers()
  expect(attach).toHaveBeenCalledTimes(1)
  expect(isInitialPaneWebglPending(panes[0])).toBe(false)
  cancelInitialPaneWebgl(panes[1])
  frames.shift()!(16)
  vi.runOnlyPendingTimers()
  expect(attach.mock.calls.map(([pane]) => pane)).toEqual([panes[0], panes[2]])
  panes.forEach(cancelInitialPaneWebgl)
})
