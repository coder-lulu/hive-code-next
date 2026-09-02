import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIVE_ACCOUNT_STATE_CHANGED_CHANNEL } from '../shared/hive-account'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL,
  HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState
} from '../shared/hive-runtime-cloud'
import type { PreloadApi } from './api-types'

const { exposeInMainWorld, invoke, on, removeListener, send, sendSync } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener, send, sendSync },
  webFrame: {
    getZoomFactor: vi.fn(() => 1),
    setZoomFactor: vi.fn(),
    setVisualZoomLevelLimits: vi.fn()
  },
  webUtils: { getPathForFile: vi.fn(() => '') }
}))

vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))

describe('Hive account and runtime cloud preload bridges', () => {
  const originalContextIsolated = Object.getOwnPropertyDescriptor(process, 'contextIsolated')

  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockReset()
    invoke.mockReset()
    on.mockReset()
    removeListener.mockReset()
    send.mockReset()
    sendSync.mockReset()
    Object.defineProperty(process, 'contextIsolated', { configurable: true, value: true })
    vi.stubGlobal('window', new EventTarget())
    vi.stubGlobal('document', { addEventListener: vi.fn() })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalContextIsolated) {
      Object.defineProperty(process, 'contextIsolated', originalContextIsolated)
    } else {
      Reflect.deleteProperty(process, 'contextIsolated')
    }
  })

  it('forwards main-process state changes and removes the exact listener on cleanup', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi
    const onStateChanged = vi.fn()
    const unsubscribe = api.hiveAccount.onStateChanged(onStateChanged)
    const listener = on.mock.calls.find(
      ([channel]) => channel === HIVE_ACCOUNT_STATE_CHANGED_CHANNEL
    )?.[1] as ((event: unknown, state: unknown) => void) | undefined
    const state = { configured: true, status: 'signed-out', persistence: 'encrypted' } as const

    listener?.({}, state)
    unsubscribe()

    expect(onStateChanged).toHaveBeenCalledExactlyOnceWith(state)
    expect(removeListener).toHaveBeenCalledWith(HIVE_ACCOUNT_STATE_CHANGED_CHANNEL, listener)
  })

  it('forwards phone binding verification as the object payload expected by main', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi

    await api.hiveAccount.verifyPhoneBinding?.('challenge-1', 'binding-1', '123456')

    expect(invoke).toHaveBeenCalledWith('hiveAccount:verifyPhoneBinding', {
      challengeId: 'challenge-1',
      bindingId: 'binding-1',
      smsCode: '123456'
    })
  })

  it('exposes runtime cloud commands that preserve their IPC payloads', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi
    const update = {
      runtimeRecordId: 'runtime-1',
      cloudDisplayName: 'Development PC',
      expectedCloudDisplayNameVersion: 3
    }
    const claim = { expectedAccountId: 'account-1' }
    const revoke = { managedWebSessionId: 'session-1', expectedControlVersion: 4 }

    await api.hiveRuntimeCloud.updateDisplayName(update)
    await api.hiveRuntimeCloud.claimLocalRuntime(claim)
    await api.hiveRuntimeCloud.revokeSession(revoke)

    expect(invoke).toHaveBeenCalledWith('hiveRuntimeCloud:updateDisplayName', update)
    expect(invoke).toHaveBeenCalledWith('hiveRuntimeCloud:claimLocalRuntime', claim)
    expect(invoke).toHaveBeenCalledWith('hiveRuntimeCloud:revokeSession', revoke)
  })

  it('forwards runtime cloud changes and removes the exact listeners on cleanup', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls.find(([name]) => name === 'api')?.[1] as PreloadApi
    const onDirectoryChanged = vi.fn()
    const onOwnershipChanged = vi.fn()
    const unsubscribeDirectory = api.hiveRuntimeCloud.onDirectoryChanged(onDirectoryChanged)
    const unsubscribeOwnership = api.hiveRuntimeCloud.onOwnershipChanged(onOwnershipChanged)
    const directoryListener = on.mock.calls.find(
      ([channel]) => channel === HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL
    )?.[1] as ((event: unknown, state: HiveAccountRuntimeDirectoryState) => void) | undefined
    const ownershipListener = on.mock.calls.find(
      ([channel]) => channel === HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL
    )?.[1] as ((event: unknown, state: HiveLocalRuntimeOwnershipState) => void) | undefined
    const directoryState: HiveAccountRuntimeDirectoryState = EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY
    const ownershipState: HiveLocalRuntimeOwnershipState = EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP

    directoryListener?.({}, directoryState)
    ownershipListener?.({}, ownershipState)
    unsubscribeDirectory()
    unsubscribeOwnership()

    expect(onDirectoryChanged).toHaveBeenCalledExactlyOnceWith(directoryState)
    expect(onOwnershipChanged).toHaveBeenCalledExactlyOnceWith(ownershipState)
    expect(removeListener).toHaveBeenCalledWith(
      HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL,
      directoryListener
    )
    expect(removeListener).toHaveBeenCalledWith(
      HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL,
      ownershipListener
    )
  })
})
