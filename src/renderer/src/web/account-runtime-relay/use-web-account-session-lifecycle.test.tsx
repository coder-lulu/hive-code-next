// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebAccountSession } from './web-account-session'
import { useWebAccountSessionLifecycle } from './use-web-account-session-lifecycle'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const authenticated = (): Response => json({ authenticated: true, csrfToken: 'original' })
const tick = (): Promise<void> =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(30_000)
  })

function fixture(fetchImpl: typeof fetch) {
  const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
  const close = vi.spyOn(session, 'close')
  const closeClients = vi.fn()
  const reload = vi.fn()
  const view = renderHook(() => useWebAccountSessionLifecycle(session, closeClients, reload))
  return { session, close, closeClients, reload, view }
}

describe('connected browser account revalidation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([408, 429, 500, 502, 503, 504])(
    'retains the connected owner after HTTP %s and revalidates later',
    async (status) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(authenticated())
        .mockResolvedValueOnce(json({}, status))
        .mockResolvedValueOnce(authenticated())
      const owner = fixture(fetchImpl)
      expect(await owner.session.restore()).toBe(true)
      await tick()
      expect(owner.closeClients).not.toHaveBeenCalled()
      expect(owner.close).not.toHaveBeenCalled()
      expect(owner.reload).not.toHaveBeenCalled()
      await tick()
      expect(fetchImpl).toHaveBeenCalledTimes(3)
      expect(owner.reload).not.toHaveBeenCalled()
    }
  )

  it.each([new TypeError('Failed to fetch'), new DOMException('Timed out', 'TimeoutError')])(
    'preserves transport recovery after %s',
    async (error) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(authenticated())
      const owner = fixture(fetchImpl)
      await tick()
      expect(owner.closeClients).not.toHaveBeenCalled()
      await tick()
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      expect(owner.reload).not.toHaveBeenCalled()
    }
  )

  it.each([401, 403])('immediately closes on explicit HTTP %s rejection', async (status) => {
    const owner = fixture(vi.fn<typeof fetch>().mockResolvedValue(json({}, status)))
    await tick()
    expect(owner.closeClients).toHaveBeenCalledTimes(1)
    expect(owner.close).toHaveBeenCalledTimes(1)
    expect(owner.reload).toHaveBeenCalledTimes(1)
  })

  it.each([
    { authenticated: false },
    { authenticated: true, csrfToken: 'replacement' },
    { invalid: 'schema' }
  ])('closes on revoked, replaced or invalid session evidence: %j', async (body) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authenticated())
      .mockResolvedValueOnce(json(body))
    const owner = fixture(fetchImpl)
    await owner.session.restore()
    await tick()
    expect(owner.closeClients).toHaveBeenCalledTimes(1)
    expect(owner.reload).toHaveBeenCalledTimes(1)
  })

  it('keeps transient restore rejected and requires fresh Cloud authorization for new material', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(authenticated())
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 403))
    const session = new WebAccountSession(fetchImpl, 'https://console.hivekernel.com')
    await session.restore()
    await expect(session.restore()).rejects.toMatchObject({ status: 503 })
    await expect(
      session.material({
        runtimeRecordId: '11111111-1111-4111-8111-111111111111',
        resourceVersion: 1,
        ownershipEpoch: 8,
        cloudDisplayName: null,
        cloudDisplayNameVersion: 1,
        status: 'CLAIMED'
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(fetchImpl.mock.calls[2]![0]).toContain('/connection-intents')
    session.close()
  })

  it('shares one in-flight check between timer and visibility and ignores its result after owner replacement', async () => {
    let settle!: (valid: boolean) => void
    const first = {
      restore: vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            settle = resolve
          })
      ),
      close: vi.fn()
    }
    const second = { restore: vi.fn().mockResolvedValue(true), close: vi.fn() }
    const closeClients = vi.fn()
    const reload = vi.fn()
    const view = renderHook(
      ({ session }) => useWebAccountSessionLifecycle(session, closeClients, reload),
      { initialProps: { session: first } }
    )
    await tick()
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    await tick()
    expect(first.restore).toHaveBeenCalledTimes(1)
    view.rerender({ session: second })
    expect(first.close).toHaveBeenCalledTimes(1)
    closeClients.mockClear()
    await act(async () => settle(false))
    expect(reload).not.toHaveBeenCalled()
    expect(closeClients).not.toHaveBeenCalled()
    expect(second.close).not.toHaveBeenCalled()
    await tick()
    expect(second.restore).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(second.close).toHaveBeenCalledTimes(1)
    await tick()
    expect(second.restore).toHaveBeenCalledTimes(1)
  })
})
