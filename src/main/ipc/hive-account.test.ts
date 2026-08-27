import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn(() => 'C:\\app-data'),
  getAllWindows: vi.fn(() => []),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler)
  })
}))

vi.mock('electron', () => ({
  app: { getPath: electronMocks.getPath },
  BrowserWindow: { getAllWindows: electronMocks.getAllWindows },
  ipcMain: { handle: electronMocks.handle }
}))

import {
  HIVE_ACCOUNT_STATE_CHANGED_CHANNEL,
  type HiveAccountState
} from '../../shared/hive-account'
import { registerHiveAccountHandlers, requireHiveAccountSignInOptions } from './hive-account'

beforeEach(() => {
  electronMocks.handlers.clear()
  electronMocks.getPath.mockClear()
  electronMocks.getAllWindows.mockReset()
  electronMocks.getAllWindows.mockReturnValue([])
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

  it('validates and forwards the selected session profile', async () => {
    const service = {
      getState: vi.fn(),
      refresh: vi.fn().mockResolvedValue({ state: { status: 'signed-out' } }),
      signIn: vi.fn().mockResolvedValue({ status: 'signed-in' }),
      signOut: vi.fn()
    }
    registerHiveAccountHandlers({ createService: () => service as never })
    const signInHandler = electronMocks.handlers.get('hiveAccount:signIn')

    await signInHandler?.(undefined, { sessionProfile: 'TRUSTED' })

    expect(service.signIn).toHaveBeenCalledWith({ sessionProfile: 'TRUSTED' })
  })

  it('broadcasts service-owned account changes to every live renderer window', () => {
    let publishState: ((state: HiveAccountState) => void) | undefined
    const liveSend = vi.fn()
    const destroyedWindowSend = vi.fn()
    electronMocks.getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: liveSend }
      },
      {
        isDestroyed: () => true,
        webContents: { isDestroyed: () => false, send: destroyedWindowSend }
      }
    ] as never)
    const service = {
      getState: vi.fn(),
      refresh: vi.fn().mockResolvedValue({ state: { status: 'signed-out' } }),
      signIn: vi.fn(),
      signOut: vi.fn()
    }

    registerHiveAccountHandlers({
      createService: (_userDataPath, onStateChanged) => {
        publishState = onStateChanged
        return service as never
      }
    })
    const state: HiveAccountState = {
      configured: true,
      status: 'signed-out',
      persistence: 'encrypted'
    }
    publishState?.(state)

    expect(liveSend).toHaveBeenCalledExactlyOnceWith(HIVE_ACCOUNT_STATE_CHANGED_CHANNEL, state)
    expect(destroyedWindowSend).not.toHaveBeenCalled()
  })

  it('uses the process service and startup refresh without starting a second refresh', async () => {
    const startupState = Promise.resolve({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted'
    } as const)
    const subscribeStateChanged = vi.fn(() => vi.fn())
    const service = {
      getState: vi.fn(),
      refresh: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      subscribeStateChanged
    }

    registerHiveAccountHandlers({ service: service as never, startupState })

    await expect(electronMocks.handlers.get('hiveAccount:getState')?.()).resolves.toMatchObject({
      status: 'signed-in'
    })
    expect(service.refresh).not.toHaveBeenCalled()
    expect(electronMocks.getPath).not.toHaveBeenCalled()
    expect(subscribeStateChanged).toHaveBeenCalledOnce()
  })
})

describe('Hive account IPC sign-in options', () => {
  it('accepts only the two explicit session profiles', () => {
    expect(requireHiveAccountSignInOptions({ sessionProfile: 'TEMPORARY' })).toEqual({
      sessionProfile: 'TEMPORARY'
    })
    expect(requireHiveAccountSignInOptions({ sessionProfile: 'TRUSTED' })).toEqual({
      sessionProfile: 'TRUSTED'
    })
  })

  it.each([
    undefined,
    {},
    { sessionProfile: 'LEGACY' },
    { sessionProfile: 'TRUSTED', extra: true }
  ])('rejects malformed renderer input %#', (value) => {
    expect(() => requireHiveAccountSignInOptions(value)).toThrow(
      'Invalid HiveCloud sign-in options'
    )
  })
})
