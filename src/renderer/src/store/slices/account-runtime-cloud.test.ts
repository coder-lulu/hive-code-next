// @vitest-environment happy-dom

import type { StateCreator } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  projectHiveRuntimeAccountClaim,
  type HiveAccountRuntimeDirectoryEntry,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState
} from '../../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import {
  AccountRuntimeClaimError,
  createAccountRuntimeCloudSlice,
  projectAccountRuntimeDirectoryOntoCatalog,
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

describe('account Runtime Cloud store sync', () => {
  it('projects cloud presence without replacing local pairing metadata', () => {
    const initialEntry = directoryEntry('runtime-1')
    const localEnvironment: PublicKnownRuntimeEnvironment = {
      id: 'local-runtime',
      name: 'Home computer',
      createdAt: 10,
      updatedAt: 20,
      pairingRevision: 7,
      lastUsedAt: 30,
      runtimeId: 'local-instance',
      runtimeRecordId: 'runtime-1',
      endpoints: [{ id: 'local', kind: 'websocket', label: 'Local', endpoint: 'ws://localhost' }],
      preferredEndpointId: 'local',
      accessSources: ['local-pairing', 'account-claimed'],
      accountClaim: projectHiveRuntimeAccountClaim(initialEntry)
    }
    const heartbeat = directoryEntry('runtime-1', {
      resourceVersion: 99,
      updatedAt: 101,
      lastHeartbeatAt: 102,
      presence: 'OFFLINE'
    })

    const [projected] = projectAccountRuntimeDirectoryOntoCatalog(
      [localEnvironment],
      readyDirectory('account-1', 1, [heartbeat])
    )

    expect(projected).toMatchObject({
      name: 'Home computer',
      updatedAt: 20,
      pairingRevision: 7,
      lastUsedAt: 30,
      accountClaim: { resourceVersion: 99, lastHeartbeatAt: 102, presence: 'OFFLINE' }
    })
  })

  it('removes stale account access immediately when the directory is cleared', () => {
    const claim = projectHiveRuntimeAccountClaim(directoryEntry('runtime-1'))
    const accountOnly = {
      ...environment('account-runtime:runtime-1'),
      accessSources: ['account-claimed'],
      accountClaim: claim
    } as PublicKnownRuntimeEnvironment
    const local = {
      ...environment('local-runtime'),
      accessSources: ['local-pairing', 'account-claimed'],
      accountClaim: claim
    } as PublicKnownRuntimeEnvironment

    const projected = projectAccountRuntimeDirectoryOntoCatalog(
      [accountOnly, local],
      EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY
    )

    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({
      id: 'local-runtime',
      accessSources: ['local-pairing']
    })
    expect(projected[0]).not.toHaveProperty('accountClaim')
  })

  it('does not let initial snapshots overwrite newer push events', async () => {
    const directorySnapshot = deferred<HiveAccountRuntimeDirectoryState>()
    const ownershipSnapshot = deferred<HiveLocalRuntimeOwnershipState>()
    let pushDirectory: ((state: HiveAccountRuntimeDirectoryState) => void) | null = null
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    const unsubscribeDirectory = vi.fn()
    const unsubscribeOwnership = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: () => directorySnapshot.promise,
          getLocalOwnership: () => ownershipSnapshot.promise,
          onDirectoryChanged: (listener: (state: HiveAccountRuntimeDirectoryState) => void) => {
            pushDirectory = listener
            return unsubscribeDirectory
          },
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return unsubscribeOwnership
          }
        }
      }
    })
    const staleDirectory: HiveAccountRuntimeDirectoryState = {
      ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      status: 'LOADING',
      accountId: 'account-1',
      sessionGeneration: 1
    }
    const pushedDirectory: HiveAccountRuntimeDirectoryState = {
      ...staleDirectory,
      status: 'READY',
      lastSyncedAt: 2
    }
    const staleOwnership: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      relation: 'ANALYZING',
      accountId: 'account-1',
      sessionGeneration: 1
    }
    const pushedOwnership: HiveLocalRuntimeOwnershipState = {
      ...staleOwnership,
      relation: 'CLAIMED_BY_CURRENT',
      runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
      checkedAt: 2
    }
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      pushedDirectory
    )
    ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(pushedOwnership)
    directorySnapshot.resolve(staleDirectory)
    ownershipSnapshot.resolve(staleOwnership)
    await Promise.all([directorySnapshot.promise, ownershipSnapshot.promise])
    await Promise.resolve()

    expect(store.getState().accountRuntimeDirectory).toBe(pushedDirectory)
    expect(store.getState().localRuntimeOwnership).toBe(pushedOwnership)
    stop()
    expect(unsubscribeDirectory).toHaveBeenCalledOnce()
    expect(unsubscribeOwnership).toHaveBeenCalledOnce()
  })

  it('does not let refresh replies overwrite push events received in flight', async () => {
    const directoryRefresh = deferred<HiveAccountRuntimeDirectoryState>()
    const ownershipRefresh = deferred<HiveLocalRuntimeOwnershipState>()
    let pushDirectory: ((state: HiveAccountRuntimeDirectoryState) => void) | null = null
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    const staleDirectory: HiveAccountRuntimeDirectoryState = {
      ...EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
      status: 'LOADING',
      accountId: 'account-1',
      sessionGeneration: 1
    }
    const pushedDirectory: HiveAccountRuntimeDirectoryState = {
      ...staleDirectory,
      status: 'READY',
      lastSyncedAt: 3
    }
    const staleOwnership: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      relation: 'ANALYZING',
      accountId: 'account-1',
      sessionGeneration: 1
    }
    const pushedOwnership: HiveLocalRuntimeOwnershipState = {
      ...staleOwnership,
      relation: 'CLAIMED_BY_CURRENT',
      runtimeRecordId: '223e4567-e89b-42d3-a456-426614174000',
      checkedAt: 3
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          refreshDirectory: () => directoryRefresh.promise,
          refreshLocalOwnership: () => ownershipRefresh.promise,
          onDirectoryChanged: (listener: (state: HiveAccountRuntimeDirectoryState) => void) => {
            pushDirectory = listener
            return vi.fn()
          },
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return vi.fn()
          }
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()

    const refreshing = store.getState().refreshAccountRuntimeCloud()
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      pushedDirectory
    )
    ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(pushedOwnership)
    directoryRefresh.resolve(staleDirectory)
    ownershipRefresh.resolve(staleOwnership)
    await refreshing

    expect(store.getState().accountRuntimeDirectory).toBe(pushedDirectory)
    expect(store.getState().localRuntimeOwnership).toBe(pushedOwnership)
    stop()
  })

  it('does not let a claim reply overwrite a newer ownership push', async () => {
    const claim = deferred<HiveLocalRuntimeOwnershipState>()
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    const staleClaim: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      relation: 'CLAIMED_BY_CURRENT',
      accountId: 'account-1',
      sessionGeneration: 1,
      runtimeRecordId: '323e4567-e89b-42d3-a456-426614174000'
    }
    const switchedAccount: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      relation: 'ANALYZING',
      accountId: 'account-2',
      sessionGeneration: 2
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          claimLocalRuntime: () => claim.promise,
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return vi.fn()
          }
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()

    const claiming = store.getState().claimLocalRuntimeForAccount('account-1')
    ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(switchedAccount)
    claim.resolve(staleClaim)
    await expect(claiming).resolves.toBe(switchedAccount)

    expect(store.getState().localRuntimeOwnership).toBe(switchedAccount)
    stop()
  })

  it('applies a terminal claim reply over an in-flight analyzing push for the same session', async () => {
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    const initial: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      stateRevision: 1,
      relation: 'PENDING_CLAIM',
      accountId: 'account-1',
      sessionGeneration: 1,
      checkedAt: 1
    }
    const analyzing: HiveLocalRuntimeOwnershipState = {
      ...initial,
      stateRevision: 2,
      relation: 'ANALYZING'
    }
    const claimed: HiveLocalRuntimeOwnershipState = {
      ...initial,
      stateRevision: 3,
      relation: 'CLAIMED_BY_CURRENT',
      runtimeRecordId: '423e4567-e89b-42d3-a456-426614174000',
      checkedAt: 2
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(initial),
          claimLocalRuntime: vi.fn().mockImplementation(async () => {
            ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(
              analyzing
            )
            return claimed
          }),
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return vi.fn()
          }
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await vi.waitFor(() => expect(store.getState().localRuntimeOwnership).toBe(initial))

    await expect(store.getState().claimLocalRuntimeForAccount('account-1')).resolves.toBe(claimed)

    expect(store.getState().localRuntimeOwnership).toBe(claimed)
    expect(window.api.hiveRuntimeCloud.claimLocalRuntime).toHaveBeenCalledWith({
      expectedAccountId: 'account-1'
    })
    stop()
  })

  it('classifies claim failure from the latest ownership push', async () => {
    const claim = deferred<HiveLocalRuntimeOwnershipState>()
    const ownershipRead = deferred<HiveLocalRuntimeOwnershipState>()
    const getLocalOwnership = vi
      .fn()
      .mockResolvedValueOnce(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP)
      .mockReturnValueOnce(ownershipRead.promise)
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    const staleRejectedOwnership: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      stateRevision: 2,
      relation: 'UNVERIFIABLE',
      accountId: 'account-1',
      sessionGeneration: 1,
      checkedAt: 2,
      errorCode: 'CLAIM_CONFLICT'
    }
    const currentRejectedOwnership: HiveLocalRuntimeOwnershipState = {
      ...staleRejectedOwnership,
      stateRevision: 3,
      checkedAt: 3,
      errorCode: 'STEP_UP_REQUIRED'
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership,
          claimLocalRuntime: () => claim.promise,
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return vi.fn()
          }
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()

    const failurePromise = store
      .getState()
      .claimLocalRuntimeForAccount('account-1')
      .catch((error: unknown) => error)
    claim.reject(new Error('redacted IPC failure'))
    await vi.waitFor(() => expect(getLocalOwnership).toHaveBeenCalledTimes(2))
    ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(
      currentRejectedOwnership
    )
    ownershipRead.resolve(staleRejectedOwnership)
    const failure = await failurePromise

    expect(failure).toBeInstanceOf(AccountRuntimeClaimError)
    expect(failure).toMatchObject({ code: 'STEP_UP_REQUIRED' })
    expect(store.getState().localRuntimeOwnership).toBe(currentRejectedOwnership)
    stop()
  })

  it('classifies a failed claim against a different active account', async () => {
    const initial: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      stateRevision: 1,
      relation: 'PENDING_CLAIM',
      accountId: 'account-1',
      sessionGeneration: 1
    }
    const switchedAccount: HiveLocalRuntimeOwnershipState = {
      ...initial,
      stateRevision: 2,
      relation: 'UNREGISTERED',
      accountId: 'account-2',
      sessionGeneration: 2
    }
    const getLocalOwnership = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(switchedAccount)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership,
          claimLocalRuntime: vi.fn().mockRejectedValue(new Error('redacted IPC failure')),
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await vi.waitFor(() => expect(store.getState().localRuntimeOwnership).toBe(initial))

    const failure = await store
      .getState()
      .claimLocalRuntimeForAccount('account-1')
      .catch((error: unknown) => error)

    expect(failure).toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect(store.getState().localRuntimeOwnership).toBe(switchedAccount)
    stop()
  })

  it('uses a terminal failure snapshot over a lagging analyzing push for the same session', async () => {
    const ownershipRead = deferred<HiveLocalRuntimeOwnershipState>()
    const initial: HiveLocalRuntimeOwnershipState = {
      ...EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
      stateRevision: 1,
      relation: 'PENDING_CLAIM',
      accountId: 'account-1',
      sessionGeneration: 1,
      checkedAt: 1
    }
    const analyzing: HiveLocalRuntimeOwnershipState = {
      ...initial,
      stateRevision: 2,
      relation: 'ANALYZING'
    }
    const rejected: HiveLocalRuntimeOwnershipState = {
      ...initial,
      stateRevision: 3,
      relation: 'UNVERIFIABLE',
      checkedAt: 2,
      errorCode: 'STEP_UP_REQUIRED'
    }
    const getLocalOwnership = vi
      .fn()
      .mockResolvedValueOnce(initial)
      .mockReturnValueOnce(ownershipRead.promise)
    let pushOwnership: ((state: HiveLocalRuntimeOwnershipState) => void) | null = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list: vi.fn().mockResolvedValue([]) },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership,
          claimLocalRuntime: vi.fn().mockRejectedValue(new Error('redacted IPC failure')),
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: (listener: (state: HiveLocalRuntimeOwnershipState) => void) => {
            pushOwnership = listener
            return vi.fn()
          }
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await vi.waitFor(() => expect(store.getState().localRuntimeOwnership).toBe(initial))

    const failurePromise = store
      .getState()
      .claimLocalRuntimeForAccount('account-1')
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(getLocalOwnership).toHaveBeenCalledTimes(2))
    ;(pushOwnership as ((state: HiveLocalRuntimeOwnershipState) => void) | null)?.(analyzing)
    ownershipRead.resolve(rejected)
    const failure = await failurePromise

    expect(failure).toMatchObject({ code: 'STEP_UP_REQUIRED' })
    expect(store.getState().localRuntimeOwnership).toBe(rejected)
    stop()
  })

  it('loads the Runtime catalog when an initial account directory arrives late', async () => {
    const directorySnapshot = deferred<HiveAccountRuntimeDirectoryState>()
    const accountEnvironment = environment('account-runtime:runtime-1')
    const list = vi.fn().mockResolvedValue([accountEnvironment])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: () => directorySnapshot.promise,
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          onDirectoryChanged: () => vi.fn(),
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()

    expect(list).not.toHaveBeenCalled()
    directorySnapshot.resolve(readyDirectory('account-1', 1, [directoryEntry('runtime-1')]))

    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(store.getState().runtimeEnvironments).toEqual([accountEnvironment])
    )
    stop()
  })

  it('projects heartbeat state into the existing catalog without another IPC list', async () => {
    let pushDirectory: ((state: HiveAccountRuntimeDirectoryState) => void) | null = null
    const initialEntry = directoryEntry('runtime-1')
    const accountEnvironment: PublicKnownRuntimeEnvironment = {
      ...environment('account-runtime:runtime-1'),
      updatedAt: initialEntry.updatedAt,
      pairingRevision: initialEntry.resourceVersion,
      lastUsedAt: initialEntry.lastHeartbeatAt,
      runtimeRecordId: initialEntry.runtimeRecordId,
      accessSources: ['account-claimed'],
      accountClaim: projectHiveRuntimeAccountClaim(initialEntry)
    }
    const list = vi.fn().mockResolvedValue([accountEnvironment])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          onDirectoryChanged: (listener: (state: HiveAccountRuntimeDirectoryState) => void) => {
            pushDirectory = listener
            return vi.fn()
          },
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()

    const initial = readyDirectory('account-1', 1, [initialEntry])
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(initial)
    await vi.waitFor(() => expect(store.getState().runtimeEnvironments).toHaveLength(1))

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.({
      ...initial,
      items: [
        {
          ...initialEntry,
          updatedAt: 2,
          presence: 'OFFLINE',
          lastHeartbeatAt: 2,
          observedAt: 2,
          freeDiskBytes: 2048
        }
      ],
      lastSyncedAt: 2
    })

    expect(list).toHaveBeenCalledTimes(1)
    expect(store.getState().runtimeEnvironments[0]).toMatchObject({
      updatedAt: 2,
      lastUsedAt: 2,
      accountClaim: {
        presence: 'OFFLINE',
        lastHeartbeatAt: 2,
        freeDiskBytes: 2048,
        cloudConnectable: false
      }
    })
    stop()
  })

  it('reloads only when the account catalog access fingerprint changes', async () => {
    let pushDirectory: ((state: HiveAccountRuntimeDirectoryState) => void) | null = null
    const list = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          onDirectoryChanged: (listener: (state: HiveAccountRuntimeDirectoryState) => void) => {
            pushDirectory = listener
            return vi.fn()
          },
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()
    await Promise.resolve()

    const initial = readyDirectory('account-1', 1, [directoryEntry('runtime-1')])
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(initial)
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.({
      ...initial,
      items: initial.items.map((item) => ({
        ...item,
        presence: 'OFFLINE' as const,
        lastHeartbeatAt: 2,
        observedAt: 2
      })),
      lastSyncedAt: 2
    })
    await Promise.resolve()
    expect(list).toHaveBeenCalledTimes(1)

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.({
      ...initial,
      items: initial.items.map((item) => ({ ...item, resourceVersion: 2 })),
      lastSyncedAt: 3
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    const aliased = {
      ...initial,
      items: initial.items.map((item) => ({
        ...item,
        resourceVersion: 2,
        cloudDisplayName: 'Shared desk',
        cloudDisplayNameVersion: 1
      })),
      lastSyncedAt: 4
    }
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(aliased)
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3))

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.({
      ...aliased,
      pendingDisplayNames: [
        {
          runtimeRecordId: 'runtime-1',
          desiredName: 'Pending desk',
          revision: 1,
          confirmed: false
        }
      ]
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(4))

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      readyDirectory('account-1', 2, [directoryEntry('runtime-1', { resourceVersion: 2 })])
    )
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(5))
    stop()
  })

  it('applies a display-name IPC result and reloads the projected catalog', async () => {
    const updated = {
      ...readyDirectory('account-1', 1, [directoryEntry('runtime-1')]),
      pendingDisplayNames: [
        {
          runtimeRecordId: 'runtime-1',
          desiredName: 'Queued name',
          revision: 1,
          confirmed: false
        }
      ]
    }
    const updateDisplayName = vi.fn().mockResolvedValue(updated)
    const list = vi.fn().mockResolvedValue([])
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: { updateDisplayName }
      }
    })
    const store = createSliceStore()

    await store.getState().updateAccountRuntimeDisplayName({
      runtimeRecordId: 'runtime-1',
      cloudDisplayName: 'Queued name',
      expectedCloudDisplayNameVersion: 1
    })

    expect(store.getState().accountRuntimeDirectory).toBe(updated)
    expect(updateDisplayName).toHaveBeenCalledWith({
      runtimeRecordId: 'runtime-1',
      cloudDisplayName: 'Queued name',
      expectedCloudDisplayNameVersion: 1
    })
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
  })

  it('does not let old catalog lists overwrite an account switch or sign-out', async () => {
    const firstList = deferred<PublicKnownRuntimeEnvironment[]>()
    const secondList = deferred<PublicKnownRuntimeEnvironment[]>()
    const signedOutList = deferred<PublicKnownRuntimeEnvironment[]>()
    const list = vi
      .fn()
      .mockReturnValueOnce(firstList.promise)
      .mockReturnValueOnce(secondList.promise)
      .mockReturnValueOnce(signedOutList.promise)
    let pushDirectory: ((state: HiveAccountRuntimeDirectoryState) => void) | null = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        runtimeEnvironments: { list },
        hiveRuntimeCloud: {
          getDirectory: vi.fn().mockResolvedValue(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY),
          getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
          onDirectoryChanged: (listener: (state: HiveAccountRuntimeDirectoryState) => void) => {
            pushDirectory = listener
            return vi.fn()
          },
          onOwnershipChanged: () => vi.fn()
        }
      }
    })
    const store = createSliceStore()
    const stop = store.getState().startAccountRuntimeCloudSync()
    await Promise.resolve()
    await Promise.resolve()

    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      readyDirectory('account-1', 1, [directoryEntry('runtime-1')])
    )
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      readyDirectory('account-2', 2, [directoryEntry('runtime-2')])
    )
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    ;(pushDirectory as ((state: HiveAccountRuntimeDirectoryState) => void) | null)?.(
      EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY
    )
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3))

    const currentEnvironment = environment('local-runtime')
    signedOutList.resolve([currentEnvironment])
    await vi.waitFor(() =>
      expect(store.getState().runtimeEnvironments).toEqual([currentEnvironment])
    )
    secondList.resolve([environment('account-runtime:runtime-2')])
    firstList.resolve([environment('account-runtime:runtime-1')])
    await Promise.all([firstList.promise, secondList.promise])
    await Promise.resolve()

    expect(store.getState().runtimeEnvironments).toEqual([currentEnvironment])
    stop()
  })
})
