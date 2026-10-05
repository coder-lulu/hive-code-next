// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
const mocks = vi.hoisted(() => {
  const accountRuntimeDirectory: HiveAccountRuntimeDirectoryState = {
    status: 'READY',
    accountId: 'account-a',
    sessionGeneration: 1,
    items: [],
    lastSyncedAt: null,
    errorCode: null
  }
  const localRuntimeOwnership: HiveLocalRuntimeOwnershipState = {
    stateRevision: 0,
    relation: 'UNVERIFIABLE',
    accountId: null,
    sessionGeneration: null,
    runtimeRecordId: null,
    ownershipEpoch: null,
    claimCapabilityAvailable: false,
    presence: 'WAITING_RUNTIME',
    checkedAt: null,
    errorCode: null
  }
  const runtimeEnvironments: PublicKnownRuntimeEnvironment[] = []
  return {
    store: {
      accountRuntimeDirectory,
      localRuntimeOwnership,
      runtimeEnvironments,
      setRuntimeEnvironments: vi.fn(),
      readRuntimeHostStatusSnapshots: vi.fn().mockResolvedValue(undefined)
    },
    list: vi.fn()
  }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign((selector: (state: unknown) => unknown) => selector(mocks.store), {
    getState: () => mocks.store
  })
}))
import { useRuntimeEnvironmentCatalog } from './use-runtime-environment-catalog'
afterEach(cleanup)

it('does not publish an old settings catalog across account changes and can refresh the current scope', async () => {
  mocks.store.accountRuntimeDirectory = {
    ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    accountId: 'account-a',
    sessionGeneration: 1
  }
  mocks.store.localRuntimeOwnership = EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP
  mocks.store.setRuntimeEnvironments.mockClear()
  mocks.store.runtimeEnvironments = []
  let finish!: (value: PublicKnownRuntimeEnvironment[]) => void
  mocks.list
    .mockReturnValueOnce(
      new Promise<PublicKnownRuntimeEnvironment[]>((resolve) => {
        finish = resolve
      })
    )
    .mockResolvedValueOnce([])
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtimeEnvironments: { list: mocks.list } }
  })
  const view = renderHook(() => useRuntimeEnvironmentCatalog())
  await waitFor(() => expect(mocks.list).toHaveBeenCalledOnce())
  mocks.store.accountRuntimeDirectory = {
    ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
    accountId: 'account-b',
    sessionGeneration: 2
  }
  await act(async () =>
    finish([
      {
        id: 'old-account-runtime',
        name: 'Old private name',
        createdAt: 1,
        updatedAt: 1,
        lastUsedAt: null,
        runtimeId: null,
        preferredEndpointId: 'cloud',
        endpoints: [],
        accessSources: ['account-claimed']
      }
    ])
  )
  expect(mocks.store.setRuntimeEnvironments).not.toHaveBeenCalled()
  expect(view.result.current.environments).toEqual([])
  await act(async () => view.result.current.loadEnvironments())
  expect(mocks.store.setRuntimeEnvironments).toHaveBeenCalledWith([])
})
