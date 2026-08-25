import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIVE_ACCOUNT_STATE_CHANGED_CHANNEL } from '../shared/hive-account'
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

describe('Hive account preload subscription', () => {
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
})
