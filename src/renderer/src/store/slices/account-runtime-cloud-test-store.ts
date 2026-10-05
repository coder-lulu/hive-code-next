import type { StateCreator } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { vi } from 'vitest'
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

export function createSliceStore(): StoreApi<TestAccountRuntimeCloudState> {
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
