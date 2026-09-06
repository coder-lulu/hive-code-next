// @vitest-environment happy-dom

import type { StateCreator } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  type HiveAccountRuntimeDirectoryEntry,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import {
  createAccountRuntimeCloudSlice,
  type AccountRuntimeCloudSlice
} from './account-runtime-cloud'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

type TestAccountRuntimeCloudState = AccountRuntimeCloudSlice & {
  runtimeEnvironments: readonly PublicKnownRuntimeEnvironment[]
  setRuntimeEnvironments: (environments: readonly PublicKnownRuntimeEnvironment[]) => void
}

function createSliceStore(): StoreApi<TestAccountRuntimeCloudState> {
  const store = createStore<TestAccountRuntimeCloudState>()(
    createAccountRuntimeCloudSlice as unknown as StateCreator<TestAccountRuntimeCloudState>
  )
  store.setState({
    runtimeEnvironments: [],
    setRuntimeEnvironments: (runtimeEnvironments) => store.setState({ runtimeEnvironments })
  })
  return store
}

function directoryEntry(
  runtimeRecordId: string,
  overrides: Partial<HiveAccountRuntimeDirectoryEntry> = {}
): HiveAccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    claimedAt: 1,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    lastHeartbeatAt: 1,
    observedAt: 1,
    freeDiskBytes: 1,
    clientAuthMode: 'IDENTITY_PROOF',
    credentialState: 'ACTIVE',
    connectionCapabilities: ['hive-relay'],
    ...overrides
  }
}

function readyDirectory(
  accountId: string,
  sessionGeneration: number,
  items: readonly HiveAccountRuntimeDirectoryEntry[]
): HiveAccountRuntimeDirectoryState {
  return {
    status: 'READY',
    accountId,
    sessionGeneration,
    items,
    lastSyncedAt: sessionGeneration,
    errorCode: null
  }
}

function environment(id: string): PublicKnownRuntimeEnvironment {
  return { id, name: id, createdAt: 1 } as PublicKnownRuntimeEnvironment
}

describe('local Runtime identity catalog refresh', () => {
  it('reloads the catalog when local identity arrives and fences an older self mirror reply', async () => {
    const staleCatalog = deferred<PublicKnownRuntimeEnvironment[]>()
    const freshCatalog = deferred<PublicKnownRuntimeEnvironment[]>()
    let pushOwnership!: (state: HiveLocalRuntimeOwnershipState) => void
    const directory = readyDirectory('account-1', 1, [directoryEntry('self')])
    const list = vi
      .fn()
      .mockReturnValueOnce(staleCatalog.promise)
      .mockReturnValueOnce(freshCatalog.promise)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: async () => directory,
          getLocalOwnership: async () => EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
          onDirectoryChanged: () => () => undefined,
          onOwnershipChanged: (listener: typeof pushOwnership) => {
            pushOwnership = listener
            return () => undefined
          }
        }
      }
    })
    const store = createSliceStore()
    const mirroredSelf = environment('account-runtime:self')
    store.setState({ accountRuntimeDirectory: directory, runtimeEnvironments: [mirroredSelf] })
    const publishCatalog = vi.fn(store.getState().setRuntimeEnvironments)
    store.setState({ setRuntimeEnvironments: publishCatalog })
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()
    pushOwnership({ ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP, runtimeRecordId: 'self' })
    expect(list).toHaveBeenCalledTimes(2)
    const remote = environment('another-computer')
    freshCatalog.resolve([remote])
    await freshCatalog.promise
    staleCatalog.resolve([mirroredSelf, remote])
    await staleCatalog.promise
    expect(publishCatalog).toHaveBeenCalledExactlyOnceWith([remote])
    expect(store.getState().runtimeEnvironments).toEqual([remote])
    pushOwnership({ ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP, runtimeRecordId: 'self', checkedAt: 10 })
    expect(list).toHaveBeenCalledTimes(2)
    stop()
  })
})
