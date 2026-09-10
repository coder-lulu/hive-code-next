// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import TerminalPane from './TerminalPane'
import type { TerminalPaneProps } from './terminal-pane-types'

const state = vi.hoisted(() => ({ ready: vi.fn(), wait: vi.fn(() => vi.fn()) }))
vi.mock('./use-terminal-pane-controller', () => ({
  useTerminalPaneController: () => ({
    managedPanes: [{}],
    visibleTerminalError: null,
    isChatViewMode: false
  })
}))
vi.mock('./TerminalPaneSurface', () => ({ TerminalPaneSurface: () => <div /> }))
vi.mock('./terminal-first-visible-render', () => ({ waitForTerminalVisibleRender: state.wait }))

it('notifies only after the visible render and does not refresh again on ordinary rerenders', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const element = document.createElement('div')
  const root = createRoot(element)
  const props = { onReady: state.ready } as unknown as TerminalPaneProps
  try {
    await act(async () => root.render(<TerminalPane {...props} />))
    expect(state.ready).not.toHaveBeenCalled()
    const callback = (state.wait.mock.calls[0] as unknown as [unknown, () => void])[1]
    await act(async () => callback())
    expect(state.ready).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<TerminalPane {...props} />))
    expect(state.wait).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
  }
})
