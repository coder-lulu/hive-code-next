import { createElement, useEffect, type ComponentProps } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
import { TerminalPaneView } from './TerminalPaneView'

const lifecycle = vi.hoisted(() => ({ mount: vi.fn(), unmount: vi.fn() }))

vi.mock('react-native', () => ({
  View: 'View',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} }
}))
vi.mock('../terminal/TerminalWebView', () => ({
  TerminalWebView: () => {
    useEffect(() => {
      lifecycle.mount()
      return lifecycle.unmount
    }, [])
    return createElement('TerminalWebView')
  }
}))

it('allocates a terminal only on first activation and preserves it across tab switches', () => {
  const props: ComponentProps<typeof TerminalPaneView> = {
    handle: 'terminal-1',
    active: false,
    keyboardLift: 0,
    textScale: 1,
    onRef: vi.fn(),
    onWebReady: vi.fn(),
    onSelectionMode: vi.fn(),
    onSelectionCopy: vi.fn(),
    onSelectionEvicted: vi.fn(),
    onModesChanged: vi.fn(),
    onKeyboardAvoidanceMetrics: vi.fn(),
    onHaptic: vi.fn(),
    onTerminalInput: vi.fn(),
    onTerminalQueryReply: vi.fn(),
    onTerminalTap: vi.fn(),
    onFileTap: vi.fn(),
    onOpenUrl: vi.fn(),
    onTextScaleChange: vi.fn()
  }
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(createElement(TerminalPaneView, props))
  })
  expect(renderer!.toJSON()).toBeNull()
  expect(lifecycle.mount).not.toHaveBeenCalled()

  act(() => {
    renderer.update(createElement(TerminalPaneView, { ...props, active: true }))
  })
  const terminal = renderer!.root.findByType('TerminalWebView')
  expect(lifecycle.mount).toHaveBeenCalledOnce()

  act(() => {
    renderer.update(createElement(TerminalPaneView, props))
  })
  expect(renderer!.root.findByType('TerminalWebView')).toBe(terminal)
  expect(renderer!.root.findByType('View').props.pointerEvents).toBe('none')
  act(() => {
    renderer.update(createElement(TerminalPaneView, { ...props, active: true }))
  })
  expect(renderer!.root.findByType('TerminalWebView')).toBe(terminal)
  expect(lifecycle.mount).toHaveBeenCalledOnce()
  expect(lifecycle.unmount).not.toHaveBeenCalled()
  act(() => renderer.unmount())
  expect(lifecycle.unmount).toHaveBeenCalledOnce()
})
