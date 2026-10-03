// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTaskPageDismissal } from './use-task-page-dismissal'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})
function escape(target: HTMLElement = document.body) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('task page Escape dismissal', () => {
  it('closes a page once and unregisters when disabled or unmounted', () => {
    const close = vi.fn()
    const hook = renderHook(({ enabled }) => useTaskPageDismissal(close, enabled), {
      initialProps: { enabled: true }
    })
    expect(escape().defaultPrevented).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    hook.rerender({ enabled: false })
    escape()
    expect(close).toHaveBeenCalledTimes(1)
    hook.rerender({ enabled: true })
    hook.unmount()
    escape()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it.each(['input', 'textarea', 'select'])(
    'first blurs a focused %s before the next Escape closes',
    (tag) => {
      const close = vi.fn()
      renderHook(() => useTaskPageDismissal(close))
      const field = document.createElement(tag)
      document.body.append(field)
      field.focus()
      escape(field)
      expect(document.activeElement).not.toBe(field)
      expect(close).not.toHaveBeenCalled()
      escape()
      expect(close).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    { role: 'dialog' },
    { role: 'alertdialog' },
    { slot: 'popover-content' },
    { slot: 'select-content' },
    { slot: 'dropdown-menu-content' },
    { role: 'menu' }
  ])('leaves dismissal to an open overlay %j', (overlay) => {
    const close = vi.fn()
    renderHook(() => useTaskPageDismissal(close))
    const element = document.createElement('div')
    if (overlay.role) {
      element.setAttribute('role', overlay.role)
    }
    if (overlay.slot) {
      element.setAttribute('data-slot', overlay.slot)
    }
    document.body.append(element)
    expect(escape().defaultPrevented).toBe(false)
    expect(close).not.toHaveBeenCalled()
    element.remove()
    escape()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
