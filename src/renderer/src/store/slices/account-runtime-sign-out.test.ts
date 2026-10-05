import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY,
  EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP,
  projectHiveRuntimeAccountClaim,
  type HiveAccountRuntimeDirectoryEntry,
  type HiveAccountRuntimeDirectoryState
} from '../../../../shared/hive-runtime-cloud'
import { toRuntimeExecutionHostId } from '../../../../shared/execution-host'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import type { Repo } from '../../../../shared/repo-types'
import type * as RuntimeRpcClientModule from '@/runtime/runtime-rpc-client'
import { createTestStore, makeTab, makeWorktree, seedStore, TEST_REPO } from './store-test-helpers'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }
}))
vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn()
}))
const rpc = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeRpcClientModule>()
  return { ...actual, callRuntimeRpc: rpc.read }
})

const ENTRY: HiveAccountRuntimeDirectoryEntry = {
  runtimeRecordId: 'runtime-1',
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
  connectionCapabilities: ['hive-relay']
}
const DIRECTORY: HiveAccountRuntimeDirectoryState = {
  status: 'READY',
  accountId: 'account-1',
  sessionGeneration: 1,
  items: [ENTRY],
  lastSyncedAt: 1,
  errorCode: null
}
const ACCOUNT_ENVIRONMENT: PublicKnownRuntimeEnvironment = {
  id: 'account-runtime:runtime-1',
  name: 'Remote computer',
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: null,
  runtimeId: null,
  pairingRevision: 1,
  endpoints: [],
  preferredEndpointId: 'account-relay',
  accessSources: ['account-claimed'],
  accountClaim: projectHiveRuntimeAccountClaim(ENTRY)
}
const PAIRED_ENVIRONMENT: PublicKnownRuntimeEnvironment = {
  ...ACCOUNT_ENVIRONMENT,
  id: 'paired-runtime',
  accessSources: ['local-pairing', 'account-claimed']
}
const REMOTE_HOST = toRuntimeExecutionHostId(ACCOUNT_ENVIRONMENT.id)
const PAIRED_HOST = toRuntimeExecutionHostId(PAIRED_ENVIRONMENT.id)
const REMOTE_WORKTREE = 'remote-repo::/remote/worktree'
const REMOTE_REPO: Repo = {
  ...TEST_REPO,
  id: 'remote-repo',
  path: '/remote',
  executionHostId: REMOTE_HOST
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.unstubAllGlobals()
})

function startSync(list = vi.fn().mockResolvedValue([ACCOUNT_ENVIRONMENT, PAIRED_ENVIRONMENT])) {
  let pushDirectory!: (directory: HiveAccountRuntimeDirectoryState) => void
  vi.stubGlobal('window', {
    api: {
      runtimeEnvironments: { list },
      hiveRuntimeCloud: {
        getDirectory: vi.fn().mockResolvedValue(DIRECTORY),
        getLocalOwnership: vi.fn().mockResolvedValue(EMPTY_HIVE_LOCAL_RUNTIME_OWNERSHIP),
        onDirectoryChanged: (listener: typeof pushDirectory) => {
          pushDirectory = listener
          return vi.fn()
        },
        onOwnershipChanged: () => vi.fn()
      }
    },
    dispatchEvent: vi.fn()
  })
  const store = createTestStore()
  seedStore(store, {
    accountRuntimeDirectory: DIRECTORY,
    runtimeEnvironments: [ACCOUNT_ENVIRONMENT, PAIRED_ENVIRONMENT],
    repos: [
      { ...TEST_REPO, executionHostId: 'local' },
      REMOTE_REPO,
      { ...TEST_REPO, id: 'paired-repo', executionHostId: PAIRED_HOST }
    ],
    worktreesByRepo: {
      'remote-repo': [
        makeWorktree({ id: REMOTE_WORKTREE, repoId: 'remote-repo', hostId: REMOTE_HOST })
      ]
    },
    tabsByWorktree: {
      [REMOTE_WORKTREE]: [makeTab({ id: 'remote-tab', worktreeId: REMOTE_WORKTREE })]
    },
    activeRepoId: 'remote-repo',
    filterRepoIds: ['repo1', 'remote-repo', 'paired-repo'],
    runtimeStatusByEnvironmentId: new Map([
      [ACCOUNT_ENVIRONMENT.id, { status: null, checkedAt: 1, error: null }],
      [PAIRED_ENVIRONMENT.id, { status: null, checkedAt: 1, error: null }]
    ])
  })
  stops.push(store.getState().startAccountRuntimeCloudSync())
  return { store, pushDirectory, list }
}

describe('account Runtime sign-out cleanup', () => {
  it('immediately retires account-only projects and sessions while preserving other hosts', () => {
    const { store, pushDirectory } = startSync(vi.fn(() => deferred().promise))

    pushDirectory(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)

    const state = store.getState()
    expect(state.repos.map((repo) => repo.id)).toEqual(['repo1', 'paired-repo'])
    expect(state.worktreesByRepo['remote-repo']).toEqual([])
    expect(state.tabsByWorktree[REMOTE_WORKTREE]).toBeUndefined()
    expect(state.activeRepoId).toBeNull()
    expect(state.filterRepoIds).toEqual(['repo1', 'paired-repo'])
    expect(state.runtimeStatusByEnvironmentId.has(ACCOUNT_ENVIRONMENT.id)).toBe(false)
    expect(state.runtimeStatusByEnvironmentId.has(PAIRED_ENVIRONMENT.id)).toBe(true)
    expect(state.removedRuntimeEnvironmentIds.has(ACCOUNT_ENVIRONMENT.id)).toBe(true)
    expect(state.runtimeEnvironments).toHaveLength(1)
    expect(state.runtimeEnvironments[0]).toMatchObject({
      id: PAIRED_ENVIRONMENT.id,
      accessSources: ['local-pairing']
    })
    expect(state.runtimeEnvironments[0]).not.toHaveProperty('accountClaim')
  })

  it('drops a project catalog reply that arrives after sign-out', async () => {
    const reply = deferred<{ repos: Repo[]; projects: never[]; setups: never[] }>()
    const started = deferred<void>()
    rpc.read.mockImplementation(() => {
      started.resolve()
      return reply.promise
    })
    const { store, pushDirectory } = startSync()
    const fetch = store.getState().fetchRuntimeEnvironmentRepos(ACCOUNT_ENVIRONMENT.id)
    await started.promise

    pushDirectory(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
    reply.resolve({ repos: [REMOTE_REPO], projects: [], setups: [] })
    await fetch

    expect(store.getState().repos.map((repo) => repo.id)).toEqual(['repo1', 'paired-repo'])
    expect(store.getState().tabsByWorktree[REMOTE_WORKTREE]).toBeUndefined()
  })

  it('ignores an environment catalog requested before sign-out', async () => {
    const stale = deferred<PublicKnownRuntimeEnvironment[]>()
    const current = deferred<PublicKnownRuntimeEnvironment[]>()
    const list = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValue(current.promise)
    const { store, pushDirectory } = startSync(list)
    await Promise.resolve()

    pushDirectory(EMPTY_HIVE_ACCOUNT_RUNTIME_DIRECTORY)
    stale.resolve([ACCOUNT_ENVIRONMENT, PAIRED_ENVIRONMENT])
    await stale.promise

    expect(store.getState().repos.map((repo) => repo.id)).toEqual(['repo1', 'paired-repo'])
    expect(store.getState().runtimeEnvironments.map((environment) => environment.id)).toEqual([
      PAIRED_ENVIRONMENT.id
    ])
    expect(store.getState().removedRuntimeEnvironmentIds.has(ACCOUNT_ENVIRONMENT.id)).toBe(true)
    current.resolve([...store.getState().runtimeEnvironments])
    await current.promise
  })

  it('keeps projects and sessions during heartbeat metadata updates', () => {
    const { store, pushDirectory } = startSync(vi.fn(() => deferred().promise))

    pushDirectory({ ...DIRECTORY, items: [{ ...ENTRY, resourceVersion: 2, lastHeartbeatAt: 2 }] })

    expect(store.getState().repos).toContain(REMOTE_REPO)
    expect(store.getState().tabsByWorktree[REMOTE_WORKTREE]).toHaveLength(1)
    expect(store.getState().runtimeStatusByEnvironmentId.has(ACCOUNT_ENVIRONMENT.id)).toBe(true)
    expect(store.getState().removedRuntimeEnvironmentIds.size).toBe(0)
  })
})
