import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, () => unknown>(),
  getPath: vi.fn(() => 'C:\\app-data'),
  handle: vi.fn((channel: string, handler: () => unknown) => {
    electronMocks.handlers.set(channel, handler)
  })
}))

vi.mock('electron', () => ({
  app: { getPath: electronMocks.getPath },
  ipcMain: { handle: electronMocks.handle }
}))

import { registerHiveAccountHandlers } from './hive-account'

beforeEach(() => {
  electronMocks.handlers.clear()
  electronMocks.getPath.mockClear()
  electronMocks.handle.mockClear()
})

describe('registerHiveAccountHandlers', () => {
  it('refreshes the stored session on startup before exposing its initial state', async () => {
    let finishRefresh: ((result: { state: { status: 'signed-in' } }) => void) | undefined
    const refresh = vi.fn(
      () =>
        new Promise<{ state: { status: 'signed-in' } }>((resolve) => {
          finishRefresh = resolve
        })
    )
    const getState = vi.fn().mockResolvedValue({ status: 'signed-out' })
    const service = {
      getState,
      refresh,
      signIn: vi.fn(),
      signOut: vi.fn()
    }

    registerHiveAccountHandlers({ createService: () => service as never })

    expect(refresh).toHaveBeenCalledOnce()
    expect(electronMocks.getPath).toHaveBeenCalledWith('userData')
    const getStateHandler = electronMocks.handlers.get('hiveAccount:getState')
    expect(getStateHandler).toBeTypeOf('function')
    const initialState = getStateHandler?.()
    expect(getState).not.toHaveBeenCalled()

    finishRefresh?.({ state: { status: 'signed-in' } })
    await expect(initialState).resolves.toEqual({ status: 'signed-in' })
    await vi.waitFor(() => expect(getState).not.toHaveBeenCalled())

    await expect(getStateHandler?.()).resolves.toEqual({ status: 'signed-out' })
    expect(getState).toHaveBeenCalledOnce()
  })
})
