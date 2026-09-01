// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from './sonner'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { settings: { theme: string } }) => unknown) =>
    selector({ settings: { theme: 'system' } })
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('Toaster', () => {
  let root: Root

  beforeEach(() => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      toast.dismiss()
      root.unmount()
    })
    document.body.replaceChildren()
  })

  it('keeps the close control while omitting the redundant error icon', async () => {
    await act(async () => root.render(<Toaster closeButton />))
    await act(async () => {
      toast.error('Connection failed')
      // Sonner delivers toast-store updates through a zero-delay task.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const renderedToast = document.querySelector('[data-sonner-toast][data-type="error"]')

    expect(renderedToast).not.toBeNull()
    expect(renderedToast?.querySelector('[data-icon]')).toBeNull()
    expect(renderedToast?.querySelector('[data-close-button]')).not.toBeNull()
  })
})
