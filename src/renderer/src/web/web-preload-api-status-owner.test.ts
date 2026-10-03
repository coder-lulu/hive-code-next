import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeHostStatusSnapshot } from '../../../shared/runtime-host-status'
import type { WebRuntimeStatusOptions } from './web-runtime-client'
import {
  installBrowserGlobals,
  writeStoredRuntimeEnvironment
} from './web-preload-api-test-harness'

beforeEach(() => {
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('./web-runtime-client')
})

it('reads and publishes the active connection owner and retires it on disconnect', async () => {
  let publish: WebRuntimeStatusOptions['publish'] | undefined
  const snapshot: RuntimeHostStatusSnapshot = {
    environmentId: 'web-server-a',
    pairingRevision: 1,
    sequence: 1,
    checkedAt: 2,
    status: null,
    verification: 'checking',
    transport: 'connecting'
  }
  vi.doMock('./web-runtime-client', () => ({
    WebRuntimeClient: class {
      readonly statusOwner = { read: () => snapshot }
      constructor(_input: unknown, options: { status: WebRuntimeStatusOptions }) {
        publish = options.status.publish
      }
      async call() {
        return { id: 'status', ok: true, result: {}, _meta: { runtimeId: 'runtime' } }
      }
      close() {
        publish?.({
          ...snapshot,
          retired: true,
          transport: 'disconnected',
          verification: 'blocked'
        })
      }
    }
  }))
  const globals = installBrowserGlobals()
  writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  const api = globals.window.api.runtimeEnvironments
  const listener = vi.fn()
  const unsubscribe = api.onStatusChanged(listener)
  await expect(api.getStatusSnapshots()).resolves.toEqual([])
  await api.getStatus({ selector: 'web-server-a' })
  await expect(api.getStatusSnapshots()).resolves.toEqual([snapshot])
  publish?.(snapshot)
  expect(listener).toHaveBeenLastCalledWith(snapshot)
  await api.disconnect({ selector: 'web-server-a' })
  expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ retired: true }))
  await expect(api.getStatusSnapshots()).resolves.toEqual([])
  unsubscribe()
  listener.mockClear()
  publish?.(snapshot)
  expect(listener).not.toHaveBeenCalled()
  await expect(globals.window.api.notifications.getDesktopAwayState()).resolves.toBeUndefined()
})

it('uses a bounded transient status probe for passive reads without retaining a connection owner', async () => {
  const close = vi.fn()
  const options: unknown[] = []
  vi.doMock('./web-runtime-client', () => ({
    WebRuntimeClient: class {
      constructor(_input: unknown, connectionOptions: unknown) {
        options.push(connectionOptions)
      }
      async call() {
        return { id: 'status', ok: true, result: {}, _meta: { runtimeId: 'runtime' } }
      }
      close = close
    }
  }))
  const globals = installBrowserGlobals()
  writeStoredRuntimeEnvironment(globals.storage, 'web-server-a')
  const { installWebPreloadApi } = await import('./web-preload-api')
  installWebPreloadApi()
  const api = globals.window.api.runtimeEnvironments
  await api.getStatus({ selector: 'web-server-a', observeOnly: true })
  expect(options).toEqual([{ reconnect: false }])
  expect(close).toHaveBeenCalledOnce()
  await expect(api.getStatusSnapshots()).resolves.toEqual([])
})
