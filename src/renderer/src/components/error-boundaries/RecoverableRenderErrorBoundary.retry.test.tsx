// @vitest-environment happy-dom

import { Suspense, act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LazyChunkLoadError } from '@/lib/lazy-with-retry'
import type { LazyChunkRecoveryReloadOutcome } from '@/lib/lazy-chunk-recovery-reload'
import { RecoverableRenderErrorBoundary } from './RecoverableRenderErrorBoundary'

const mocks = vi.hoisted(() => ({ reload: vi.fn(), reportCrash: vi.fn() }))

vi.mock('@/lib/lazy-chunk-recovery-reload', () => ({
  requestLazyChunkRecoveryReload: mocks.reload
}))
vi.mock('@/lib/react-error-boundary-reporting', () => ({
  reportReactErrorBoundaryCrash: mocks.reportCrash
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('RecoverableRenderErrorBoundary retry', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.reload.mockReset()
    mocks.reportCrash.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })

  async function renderFailure(error: Error): Promise<void> {
    function BrokenSurface(): ReactElement {
      throw error
    }
    await act(async () => {
      root.render(
        <RecoverableRenderErrorBoundary boundaryId="page.tasks" surface="page">
          <Suspense fallback={null}>
            <BrokenSurface />
          </Suspense>
        </RecoverableRenderErrorBoundary>
      )
    })
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  }

  it('joins protected reload for a chunk failure and prevents overlapping retries', async () => {
    let completeReload: (outcome: LazyChunkRecoveryReloadOutcome) => void = () => undefined
    mocks.reload.mockReturnValue(
      new Promise<LazyChunkRecoveryReloadOutcome>((resolve) => {
        completeReload = resolve
      })
    )
    await renderFailure(
      new LazyChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))
    )
    const button = container.querySelector('button')
    expect(button).not.toBeNull()

    await act(async () => {
      button?.click()
    })

    expect(mocks.reload).toHaveBeenCalledExactlyOnceWith(window)
    expect(button?.disabled).toBe(true)
    await act(async () => {
      button?.click()
    })
    expect(mocks.reload).toHaveBeenCalledTimes(1)

    await act(async () => {
      completeReload('checkpoint-refused')
    })

    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(button?.disabled).toBe(false)
    expect(mocks.reportCrash).not.toHaveBeenCalled()
  })

  it('keeps the fallback recoverable after the host rejects a reload request', async () => {
    mocks.reload.mockRejectedValue(new Error('Host rejected reload'))
    await renderFailure(new LazyChunkLoadError(new SyntaxError('Unexpected token')))

    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(mocks.reload).toHaveBeenCalledExactlyOnceWith(window)
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
    expect(container.querySelector('button')?.disabled).toBe(false)
  })

  it('remounts an ordinary rendering failure without reloading the document', async () => {
    let broken = true
    function Surface(): ReactElement {
      if (broken) {
        throw new Error('Ordinary render failure')
      }
      return <div>Recovered task surface</div>
    }
    await act(async () => {
      root.render(
        <RecoverableRenderErrorBoundary boundaryId="page.tasks" surface="page">
          <Surface />
        </RecoverableRenderErrorBoundary>
      )
    })
    expect(container.querySelector('[role="alert"]')).not.toBeNull()

    broken = false
    await act(async () => {
      container.querySelector('button')?.click()
    })

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(container.textContent).toContain('Recovered task surface')
    expect(mocks.reload).not.toHaveBeenCalled()
  })
})
