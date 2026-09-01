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
import {
  registerHiveAccountHandlers,
  requireHiveAccountPassword,
  requireHiveAccountPasswordResetVerification,
  requireHiveAccountPhoneNumber,
  requireHiveAccountPhoneVerification,
  requireHiveAccountSignInOptions,
  requireHiveAccountSmsSignInOptions,
  requireHiveAccountSmsVerifyOptions
} from './hive-account'

beforeEach(() => {
  electronMocks.handlers.clear()
  electronMocks.getPath.mockClear()
  electronMocks.getAllWindows.mockReset()
  electronMocks.getAllWindows.mockReturnValue([])
  electronMocks.handle.mockClear()
})

describe('registerHiveAccountHandlers', () => {
  it('returns the stored state without waiting for the startup refresh', async () => {
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
    const getStateCallsBeforeRefreshSettles = getState.mock.calls.length
    const initialResult = await Promise.race([
      Promise.resolve(initialState).then((state) => ({ status: 'resolved' as const, state })),
      new Promise<{ status: 'pending' }>((resolve) =>
        setTimeout(() => resolve({ status: 'pending' }), 20)
      )
    ])

    finishRefresh?.({ state: { status: 'signed-in' } })
    expect(getStateCallsBeforeRefreshSettles).toBe(1)
    expect(initialResult).toEqual({ status: 'resolved', state: { status: 'signed-out' } })

    await expect(getStateHandler?.()).resolves.toEqual({ status: 'signed-out' })
    expect(getState).toHaveBeenCalledTimes(2)
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

  it('exposes login capabilities through a read-only handler', async () => {
    const capabilities = {
      contractRevision: 'hive-login-capabilities-v1',
      clientId: 'hivecode-desktop',
      defaultMethod: 'phone_sms',
      providers: []
    } as const
    const service = {
      getLoginCapabilities: vi.fn().mockResolvedValue(capabilities),
      getState: vi.fn(),
      refresh: vi.fn().mockResolvedValue({ state: { status: 'signed-out' } }),
      signIn: vi.fn(),
      signOut: vi.fn()
    }
    registerHiveAccountHandlers({ createService: () => service as never })

    await expect(electronMocks.handlers.get('hiveAccount:getLoginCapabilities')?.()).resolves.toBe(
      capabilities
    )
    expect(service.getLoginCapabilities).toHaveBeenCalledOnce()
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

  it('keeps the cached state responsive and broadcasts the completed startup refresh', async () => {
    let publishState: ((state: HiveAccountState) => void) | undefined
    const refreshGate = deferred<void>()
    const refreshedState: HiveAccountState = {
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted',
      account: {
        accountId: 'account-1',
        displayName: 'Ada'
      }
    }
    const send = vi.fn()
    electronMocks.getAllWindows.mockReturnValue([
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send }
      }
    ] as never)
    const refresh = vi.fn(async () => {
      await refreshGate.promise
      publishState?.(refreshedState)
      return { state: refreshedState }
    })
    const service = {
      getState: vi.fn().mockResolvedValue({
        configured: true,
        status: 'signed-out',
        persistence: 'encrypted'
      }),
      refresh,
      signIn: vi.fn(),
      signOut: vi.fn()
    }

    registerHiveAccountHandlers({
      createService: (_userDataPath, onStateChanged) => {
        publishState = onStateChanged
        return service as never
      }
    })

    await expect(electronMocks.handlers.get('hiveAccount:getState')?.()).resolves.toMatchObject({
      status: 'signed-out'
    })
    expect(send).not.toHaveBeenCalled()

    refreshGate.resolve()
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledExactlyOnceWith(
        HIVE_ACCOUNT_STATE_CHANGED_CHANNEL,
        refreshedState
      )
    })
  })

  it('uses the process service and startup refresh without starting a second refresh', async () => {
    const startupState = Promise.resolve({
      configured: true,
      status: 'signed-in',
      persistence: 'encrypted'
    } as const)
    const subscribeStateChanged = vi.fn(() => vi.fn())
    const service = {
      getState: vi.fn().mockResolvedValue({
        configured: true,
        status: 'signed-out',
        persistence: 'encrypted'
      }),
      refresh: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
      subscribeStateChanged
    }

    registerHiveAccountHandlers({ service: service as never, startupState })

    await expect(electronMocks.handlers.get('hiveAccount:getState')?.()).resolves.toMatchObject({
      status: 'signed-out'
    })
    expect(service.getState).toHaveBeenCalledOnce()
    expect(service.refresh).not.toHaveBeenCalled()
    expect(electronMocks.getPath).not.toHaveBeenCalled()
    expect(subscribeStateChanged).toHaveBeenCalledOnce()
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('Hive account IPC sign-in options', () => {
  it('accepts only the two explicit session profiles', () => {
    expect(requireHiveAccountSignInOptions({ sessionProfile: 'TEMPORARY' })).toEqual({
      sessionProfile: 'TEMPORARY'
    })
    expect(requireHiveAccountSignInOptions({ sessionProfile: 'TRUSTED' })).toEqual({
      sessionProfile: 'TRUSTED'
    })
    expect(
      requireHiveAccountSignInOptions({ sessionProfile: 'TRUSTED', providerId: 'github' })
    ).toEqual({ sessionProfile: 'TRUSTED', providerId: 'github' })
    expect(
      requireHiveAccountSignInOptions({ sessionProfile: 'TRUSTED', intent: 'STEP_UP' })
    ).toEqual({ sessionProfile: 'TRUSTED', intent: 'STEP_UP' })
  })

  it.each([
    undefined,
    {},
    { sessionProfile: 'LEGACY' },
    { sessionProfile: 'TRUSTED', providerId: 'gitlab' },
    { sessionProfile: 'TRUSTED', intent: 'step-up' },
    { sessionProfile: 'TRUSTED', intent: 'STEP_UP', providerId: 'github' },
    { sessionProfile: 'TRUSTED', intent: undefined },
    { sessionProfile: 'TRUSTED', providerId: undefined },
    { sessionProfile: 'TRUSTED', extra: true }
  ])('rejects malformed renderer input %#', (value) => {
    expect(() => requireHiveAccountSignInOptions(value)).toThrow(
      'Invalid HiveCloud sign-in options'
    )
  })
})

describe('Hive account IPC security inputs', () => {
  const challengeId = 'a'.repeat(32)
  const resetBindingId = 'b'.repeat(64)
  const phoneBindingId = `123e4567-e89b-42d3-a456-426614174000.${'c'.repeat(64)}`
  const password = 'StrongPassword!2026'

  it('normalizes and accepts bounded account-security values', () => {
    expect(requireHiveAccountPhoneNumber(' +8613800138000 ')).toBe('+8613800138000')
    expect(requireHiveAccountPassword(password)).toBe(password)
    expect(
      requireHiveAccountPasswordResetVerification({
        challengeId,
        bindingId: resetBindingId,
        smsCode: '123456',
        newPassword: password
      })
    ).toEqual({ challengeId, bindingId: resetBindingId, smsCode: '123456', newPassword: password })
    expect(
      requireHiveAccountPhoneVerification({
        challengeId,
        bindingId: phoneBindingId,
        smsCode: '123456'
      })
    ).toEqual({ challengeId, bindingId: phoneBindingId, smsCode: '123456' })
  })

  it.each([
    undefined,
    [],
    '',
    '+12',
    '+8613800138000x',
    `+${'1'.repeat(21)}`,
    { phoneNumber: '+8613800138000' }
  ])('rejects malformed or oversized phone input %#', (value) => {
    expect(() => requireHiveAccountPhoneNumber(value)).toThrow('Invalid phone number')
  })

  it.each([
    undefined,
    [],
    'short',
    'a'.repeat(129),
    `StrongPassword!${String.fromCharCode(0)}2026`
  ])('rejects malformed or oversized password input %#', (value) => {
    expect(() => requireHiveAccountPassword(value)).toThrow('Invalid HiveCloud password')
  })

  it.each([
    null,
    [],
    { challengeId, bindingId: resetBindingId, smsCode: '123456' },
    {
      challengeId: 'not-a-challenge',
      bindingId: resetBindingId,
      smsCode: '123456',
      newPassword: password
    },
    {
      challengeId,
      bindingId: 'x'.repeat(129),
      smsCode: '123456',
      newPassword: password
    },
    {
      challengeId,
      bindingId: resetBindingId,
      smsCode: '12345',
      newPassword: password
    },
    {
      challengeId,
      bindingId: resetBindingId,
      smsCode: '123456',
      newPassword: password,
      extra: true
    }
  ])('rejects malformed password-reset verification %#', (value) => {
    expect(() => requireHiveAccountPasswordResetVerification(value)).toThrow(
      'Invalid password reset verification'
    )
  })

  it.each([
    null,
    [],
    { challengeId, bindingId: phoneBindingId },
    { challengeId: 'not-a-challenge', bindingId: phoneBindingId, smsCode: '123456' },
    { challengeId, bindingId: 'bad binding!', smsCode: '123456' },
    { challengeId, bindingId: phoneBindingId, smsCode: '123456', extra: true }
  ])('rejects malformed phone verification %#', (value) => {
    expect(() => requireHiveAccountPhoneVerification(value)).toThrow('Invalid phone verification')
  })

  it('rejects unknown keys on SMS sign-in and verification payloads', () => {
    expect(() =>
      requireHiveAccountSmsSignInOptions({
        phoneNumber: '+8613800138000',
        sessionProfile: 'TRUSTED',
        termsAccepted: true,
        extra: true
      })
    ).toThrow('Invalid HiveCloud SMS options')
    expect(() =>
      requireHiveAccountSmsVerifyOptions({ challengeId, smsCode: '123456', extra: true })
    ).toThrow('Invalid HiveCloud SMS verification')
  })
})
