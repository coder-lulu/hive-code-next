// @vitest-environment happy-dom

import type { StateCreator } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  type HiveAccountRuntimeDirectoryEntry,
  type HiveAccountRuntimeDirectoryState
} from '../../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { RuntimeStatusSlice } from './runtime-status-types'
import {
  createAccountRuntimeCloudSlice,
  type AccountRuntimeCloudSlice
} from './account-runtime-cloud'

type TestAccountRuntimeCloudState = AccountRuntimeCloudSlice &
  Pick<RuntimeStatusSlice, 'runtimeStatusByEnvironmentId' | 'refreshRuntimeEnvironmentStatus'> & {
    runtimeEnvironments: readonly PublicKnownRuntimeEnvironment[]
    setRuntimeEnvironments: (environments: readonly PublicKnownRuntimeEnvironment[]) => void
  }

function createSliceStore(): StoreApi<TestAccountRuntimeCloudState> {
  const store = createStore<TestAccountRuntimeCloudState>()(
    createAccountRuntimeCloudSlice as unknown as StateCreator<TestAccountRuntimeCloudState>
  )
  store.setState({
    runtimeEnvironments: [],
    runtimeStatusByEnvironmentId: new Map(),
    refreshRuntimeEnvironmentStatus: vi.fn().mockResolvedValue(true),
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
    ownershipEpoch: 1,
    cloudDisplayName: null,
    cloudDisplayNameVersion: 1,
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

describe('account Runtime login discovery', () => {
  it('probes newly discovered account hosts after login without restarting', async () => {
    let pushDirectory!: (state: HiveAccountRuntimeDirectoryState) => void
    const known = environment('paired-runtime')
    const discovered = environment('account-runtime:runtime-1')
    const failing = environment('account-runtime:runtime-2')
    const list = vi.fn().mockResolvedValue([known, failing, discovered])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          onDirectoryChanged: (listener: typeof pushDirectory) => {
            pushDirectory = listener
            return vi.fn()
          },
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const probe = vi.fn(async (id: string) => {
      expect(store.getState().runtimeEnvironments).toContain(discovered)
      if (id === failing.id) {
        throw new Error('Host unavailable')
      }
      store.setState({
        runtimeStatusByEnvironmentId: new Map([
          ...store.getState().runtimeStatusByEnvironmentId,
          [id, { status: null, checkedAt: 1 }]
        ])
      })
      return true
    })
    store.setState({
      runtimeEnvironments: [known],
      runtimeStatusByEnvironmentId: new Map([[known.id, { status: null, checkedAt: 1 }]]),
      refreshRuntimeEnvironmentStatus: probe
    })
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()
    expect(probe).not.toHaveBeenCalled()

    const directory = readyDirectory('account-1', 1, [
      directoryEntry('runtime-1'),
      directoryEntry('runtime-2')
    ])
    pushDirectory(directory)
    await vi.waitFor(() => expect(probe).toHaveBeenCalledWith(discovered.id))
    expect(probe).toHaveBeenCalledWith(failing.id)
    expect(probe).not.toHaveBeenCalledWith(known.id)

    pushDirectory({ ...directory, lastSyncedAt: 2 })
    await Promise.resolve()
    expect(probe).toHaveBeenCalledTimes(2)
    stop()
  })
})
