import { afterEach, describe, expect, it, vi } from 'vitest'

const { setBadgeMock, getAllWindowsMock, createFromDataURLMock } = vi.hoisted(() => ({
  setBadgeMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  createFromDataURLMock: vi.fn()
}))

const setOverlayIconMock = vi.hoisted(() => vi.fn())
const isDestroyedMock = vi.hoisted(() => vi.fn(() => false))

vi.mock('electron', () => ({
  app: {
    dock: {
      setBadge: setBadgeMock
    }
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock
  },
  nativeImage: {
    createFromDataURL: createFromDataURLMock
  }
}))

describe('unread Dock badge', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
    setBadgeMock.mockReset()
    getAllWindowsMock.mockReset()
    createFromDataURLMock.mockReset()
    setOverlayIconMock.mockReset()
    isDestroyedMock.mockReset().mockReturnValue(false)
    vi.resetModules()
  })

  it('clears the native badge when unread count is zero', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(5)
    expect(setBadgeMock).toHaveBeenLastCalledWith('5')
    expect(createFromDataURLMock).not.toHaveBeenCalled()

    setUnreadDockBadgeCount(0)
    expect(setBadgeMock).toHaveBeenLastCalledWith('')
  })

  it('caps unread counts', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(104)
    expect(setBadgeMock).toHaveBeenLastCalledWith('99+')
  })

  it('uses a numeric overlay on Windows and clears it when acknowledged', async () => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
    const window = {
      isDestroyed: isDestroyedMock,
      setOverlayIcon: setOverlayIconMock
    }
    getAllWindowsMock.mockReturnValue([window])
    createFromDataURLMock.mockReturnValue({ kind: 'badge-image' })
    const { setUnreadDockBadgeCount } = await import('./unread-badge')

    setUnreadDockBadgeCount(3)
    expect(createFromDataURLMock).toHaveBeenCalledTimes(1)
    expect(setOverlayIconMock).toHaveBeenLastCalledWith(
      { kind: 'badge-image' },
      '3 unread completed tasks'
    )

    setUnreadDockBadgeCount(0)
    expect(setOverlayIconMock).toHaveBeenLastCalledWith(null, '')
  })
})
