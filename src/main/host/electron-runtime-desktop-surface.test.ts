import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ waitForTabRegistration: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn() },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  Notification: { isSupported: () => false },
  powerMonitor: {}
}))
vi.mock('../ipc/browser-tab-registration-wait', () => ({
  waitForTabRegistration: mocks.waitForTabRegistration
}))

import { electronRuntimeDesktopSurface } from './electron-runtime-desktop-surface'

afterEach(() => vi.resetAllMocks())

describe('Electron desktop browser registration port', () => {
  it('returns the actual guest-registration promise for the requested page', async () => {
    let register!: () => void
    const registration = new Promise<void>((resolve) => {
      register = resolve
    })
    mocks.waitForTabRegistration.mockReturnValue(registration)
    const waiting = electronRuntimeDesktopSurface.waitForBrowserTabRegistration('page-a')
    expect(waiting).toBe(registration)
    expect(mocks.waitForTabRegistration).toHaveBeenCalledExactlyOnceWith('page-a')
    register()
    await expect(waiting).resolves.toBeUndefined()
  })

  it('propagates registration failure so restoration can retry', async () => {
    const failure = new Error('Tab registration timed out')
    mocks.waitForTabRegistration.mockRejectedValue(failure)
    await expect(
      electronRuntimeDesktopSurface.waitForBrowserTabRegistration('page-b')
    ).rejects.toBe(failure)
    expect(mocks.waitForTabRegistration).toHaveBeenCalledExactlyOnceWith('page-b')
  })
})
