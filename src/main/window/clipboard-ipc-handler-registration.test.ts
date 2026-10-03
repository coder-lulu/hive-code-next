import { beforeEach, describe, expect, it, vi } from 'vitest'

const { removeHandlerMock, handleMock } = vi.hoisted(() => ({
  removeHandlerMock: vi.fn(),
  handleMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  clipboard: {
    readText: vi.fn(),
    readBuffer: vi.fn(),
    writeText: vi.fn(),
    readImage: vi.fn(),
    writeImage: vi.fn(),
    writeBuffer: vi.fn()
  },
  ipcMain: {
    removeHandler: removeHandlerMock,
    handle: handleMock
  },
  nativeImage: { createFromBuffer: vi.fn() }
}))

vi.mock('./clipboard-remote-file-copy', () => ({
  cleanupExpiredRemoteClipboardFiles: vi.fn().mockResolvedValue(undefined),
  scheduleLegacyRemoteClipboardFileCleanup: vi.fn(),
  writeRemoteFileToClipboard: vi.fn()
}))

vi.mock('./dashboard-popout-window', () => ({ isDashboardPopoutRenderer: () => false }))

import { registerClipboardHandlers } from './clipboard-ipc-handlers'

describe('clipboard IPC handler registration', () => {
  beforeEach(() => {
    removeHandlerMock.mockReset()
    handleMock.mockReset()
  })

  it('removes stale clipboard IPC handlers before registering replacements', () => {
    registerClipboardHandlers({} as never)

    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:readText')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:readSelectionText')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:writeText')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:writeSelectionText')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:writeImage')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:writeFile')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:saveImageAsTempFile')
    expect(removeHandlerMock).toHaveBeenCalledWith('clipboard:readImageThumbnail')
  })
})
