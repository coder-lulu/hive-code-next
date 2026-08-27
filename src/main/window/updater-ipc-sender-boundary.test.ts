import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, productUpdatePolicy, trustedSender, updaterMocks } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  productUpdatePolicy: { configured: true },
  trustedSender: { id: 1 },
  updaterMocks: {
    checkForUpdatesFromMenu: vi.fn(),
    dismissAvailableUpdate: vi.fn(),
    dismissNudge: vi.fn(),
    downloadUpdate: vi.fn(),
    getLinuxPackageInstallInstructions: vi.fn(() => 'instructions'),
    getUpdateStatus: vi.fn(() => ({ state: 'idle' })),
    listAvailableReleaseBuilds: vi.fn(() => Promise.resolve([])),
    quitAndInstall: vi.fn(),
    reportReleaseUpdatesDisabled: vi.fn(),
    showLinuxPackage: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '1.2.3') },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  }
}))

vi.mock('../updater', () => ({
  ...updaterMocks,
  setupAutoUpdater: vi.fn()
}))

vi.mock('../../shared/product-update-policy', () => ({
  hasConfiguredProductUpdateChannel: vi.fn(() => productUpdatePolicy.configured)
}))

vi.mock('../ipc/ui', () => ({
  isTrustedUIRenderer: (sender: unknown) => sender === trustedSender
}))

import { registerUpdaterHandlers } from './attach-main-window-services'

const invocationArgs: Record<string, unknown[]> = {
  'updater:check': [{ localBuild: true }],
  'updater:listBuilds': ['stable']
}

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`Missing handler for ${channel}`)
  }
  return handler
}

describe('updater IPC sender boundary', () => {
  beforeEach(() => {
    handlers.clear()
    productUpdatePolicy.configured = true
    for (const mock of Object.values(updaterMocks)) {
      mock.mockClear()
    }
    registerUpdaterHandlers({} as never)
  })

  it('rejects every updater handler from an untrusted renderer', async () => {
    for (const channel of handlers.keys()) {
      const invoke = () =>
        getHandler(channel)({ sender: { id: 2 } }, ...(invocationArgs[channel] ?? []))
      await expect(Promise.resolve().then(invoke)).rejects.toThrow(
        'Unauthorized updater IPC sender'
      )
    }

    for (const mock of Object.values(updaterMocks)) {
      expect(mock).not.toHaveBeenCalled()
    }
  })

  it('keeps updater actions available to the trusted main renderer', async () => {
    expect(getHandler('updater:getStatus')({ sender: trustedSender })).toEqual({ state: 'idle' })
    getHandler('updater:check')({ sender: trustedSender }, { localBuild: true })
    getHandler('updater:download')({ sender: trustedSender })
    getHandler('updater:quitAndInstall')({ sender: trustedSender })
    await getHandler('updater:listBuilds')({ sender: trustedSender }, 'stable')

    expect(updaterMocks.checkForUpdatesFromMenu).toHaveBeenCalledWith({ localBuild: true })
    expect(updaterMocks.downloadUpdate).toHaveBeenCalledOnce()
    expect(updaterMocks.quitAndInstall).toHaveBeenCalledOnce()
    expect(updaterMocks.listAvailableReleaseBuilds).toHaveBeenCalledWith('stable')
  })

  it('reports disabled without initializing a release updater when no product source exists', () => {
    productUpdatePolicy.configured = false

    getHandler('updater:check')({ sender: trustedSender })

    expect(updaterMocks.reportReleaseUpdatesDisabled).toHaveBeenCalledOnce()
    expect(updaterMocks.checkForUpdatesFromMenu).not.toHaveBeenCalled()
  })
})
