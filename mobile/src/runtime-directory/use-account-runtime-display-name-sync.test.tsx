import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadScope: vi.fn(),
  enqueue: vi.fn(),
  reconcileDirectory: vi.fn(),
  subscribeRevival: vi.fn(() => () => undefined)
}))

vi.mock('react-native', () => ({
  AppState: { currentState: 'background' }
}))
vi.mock('../transport/connection-revival-triggers', () => ({
  subscribeConnectionRevivalTriggers: mocks.subscribeRevival
}))
vi.mock('./account-runtime-display-name-pending', () => ({
  AccountRuntimeDisplayNamePendingStore: class {
    loadScope = mocks.loadScope
    enqueue = mocks.enqueue
    reconcileDirectory = mocks.reconcileDirectory
  }
}))
vi.mock('./account-runtime-display-name-client', () => ({
  loadAccountRuntime: vi.fn(),
  updateAccountRuntimeDisplayName: vi.fn()
}))
vi.mock('./account-runtime-display-name-retry', () => ({
  retryPendingRuntimeDisplayNames: vi.fn()
}))

import type { MobileSession } from '../auth/mobile-sms-auth'
import type { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import { accountRuntimeScopeOf } from './account-runtime-session-operation'
import { useAccountRuntimeDisplayNameSync } from './use-account-runtime-display-name-sync'

const accountA = session('account-a', 3_000)
const accountB = session('account-b', 4_000)
const sessionRef: { current: MobileSession | null } = { current: accountA }
let snapshotScope = accountRuntimeScopeOf(accountA)
let snapshotEntries: readonly AccountRuntimeDirectoryEntry[] = []
let latest: ReturnType<typeof useAccountRuntimeDisplayNameSync> | null = null

const directoryStore = {
  getSnapshot: () => ({ scope: snapshotScope, entries: snapshotEntries })
} as unknown as AccountRuntimeDirectoryStore
const requestDirectoryRefreshRef = { current: () => undefined }
const withCurrentSession = async <T,>(
  operation: (session: MobileSession) => Promise<T>
): Promise<T> => {
  const current = sessionRef.current
  if (!current) {
    throw new Error('mobile_session_required')
  }
  return operation(current)
}

function Harness({ session: currentSession }: { session: MobileSession | null }) {
  latest = useAccountRuntimeDisplayNameSync({
    session: currentSession,
    sessionRef,
    directoryStore,
    withCurrentSession,
    requestDirectoryRefreshRef
  })
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionRef.current = accountA
  snapshotScope = accountRuntimeScopeOf(accountA)
  snapshotEntries = []
  latest = null
})

describe('useAccountRuntimeDisplayNameSync scope fencing', () => {
  it('hides account A immediately while account B pending load is delayed and rejects', async () => {
    const accountBLoad = deferred<readonly PendingTask[]>()
    mocks.loadScope
      .mockResolvedValueOnce([pendingTask('runtime-a', 'Account A pending')])
      .mockReturnValueOnce(accountBLoad.promise)
    const renderer = await renderHarness(accountA)

    expect(latest?.pendingDisplayNames.get('runtime-a')).toBe('Account A pending')
    sessionRef.current = accountB
    snapshotScope = accountRuntimeScopeOf(accountB)
    await act(async () => {
      renderer.update(createElement(Harness, { session: accountB }))
      await Promise.resolve()
    })

    expect(latest?.pendingDisplayNames.size).toBe(0)
    accountBLoad.reject(new Error('storage unavailable'))
    await flush()
    expect(latest?.pendingDisplayNames.size).toBe(0)
    act(() => renderer.unmount())
  })

  it('never lets a delayed account A load overwrite the current account B overlay', async () => {
    const accountALoad = deferred<readonly PendingTask[]>()
    const accountBLoad = deferred<readonly PendingTask[]>()
    mocks.loadScope
      .mockReturnValueOnce(accountALoad.promise)
      .mockReturnValueOnce(accountBLoad.promise)
    const renderer = await renderHarness(accountA, false)
    await vi.waitFor(() => expect(mocks.loadScope).toHaveBeenCalledTimes(1))

    sessionRef.current = accountB
    snapshotScope = accountRuntimeScopeOf(accountB)
    await act(async () => {
      renderer.update(createElement(Harness, { session: accountB }))
      await Promise.resolve()
    })
    expect(latest?.pendingDisplayNames.size).toBe(0)
    await vi.waitFor(() => expect(mocks.loadScope).toHaveBeenCalledTimes(2))

    accountBLoad.resolve([pendingTask('runtime-b', 'Account B pending')])
    await flush()
    expect([...(latest?.pendingDisplayNames ?? new Map()).entries()]).toEqual([
      ['runtime-b', 'Account B pending']
    ])

    accountALoad.resolve([pendingTask('runtime-a', 'Late account A pending')])
    await flush()
    expect([...(latest?.pendingDisplayNames ?? new Map()).entries()]).toEqual([
      ['runtime-b', 'Account B pending']
    ])
    act(() => renderer.unmount())
  })

  it('clears the overlay when the same account is replaced by a new session generation', async () => {
    const replacementLoad = deferred<readonly PendingTask[]>()
    mocks.loadScope
      .mockResolvedValueOnce([pendingTask('runtime-a', 'Old generation pending')])
      .mockReturnValueOnce(replacementLoad.promise)
    const renderer = await renderHarness(accountA)
    expect(latest?.pendingDisplayNames.get('runtime-a')).toBe('Old generation pending')

    const replacement = { ...accountA, sessionExpiresAt: accountA.sessionExpiresAt + 1 }
    sessionRef.current = replacement
    snapshotScope = accountRuntimeScopeOf(replacement)
    await act(async () => {
      renderer.update(createElement(Harness, { session: replacement }))
      await Promise.resolve()
    })

    expect(latest?.pendingDisplayNames.size).toBe(0)
    replacementLoad.resolve([])
    await flush()
    expect(latest?.pendingDisplayNames.size).toBe(0)
    act(() => renderer.unmount())
  })

  it('rejects a queued edit when the account scope changed after the editor loaded', async () => {
    const entry = directoryEntry()
    snapshotEntries = [entry]
    mocks.loadScope.mockResolvedValue([])
    const renderer = await renderHarness(accountA)

    sessionRef.current = accountB
    snapshotScope = accountRuntimeScopeOf(accountB)
    snapshotEntries = [{ ...entry, resourceVersion: 8, cloudDisplayNameVersion: 4 }]

    await expect(
      latest?.queueDisplayNameUpdate({
        runtimeRecordId: entry.runtimeRecordId,
        desiredName: 'Stale account A draft',
        expectedScope: accountRuntimeScopeOf(accountA),
        expectedResourceVersion: entry.resourceVersion,
        expectedCloudDisplayNameVersion: entry.cloudDisplayNameVersion!
      })
    ).rejects.toThrow('runtime_display_name_target_stale')
    expect(mocks.enqueue).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })

  it('rejects a queued edit after the Runtime ownership epoch changes', async () => {
    const entry = directoryEntry()
    snapshotEntries = [entry]
    mocks.loadScope.mockResolvedValue([])
    const renderer = await renderHarness(accountA)

    snapshotEntries = [{ ...entry, resourceVersion: entry.resourceVersion + 1 }]
    await expect(
      latest?.queueDisplayNameUpdate({
        runtimeRecordId: entry.runtimeRecordId,
        desiredName: 'Stale ownership draft',
        expectedScope: accountRuntimeScopeOf(accountA),
        expectedResourceVersion: entry.resourceVersion,
        expectedCloudDisplayNameVersion: entry.cloudDisplayNameVersion!
      })
    ).rejects.toThrow('runtime_display_name_unavailable')
    expect(mocks.enqueue).not.toHaveBeenCalled()
    act(() => renderer.unmount())
  })
})

async function renderHarness(
  currentSession: MobileSession,
  flushEffects = true
): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(Harness, { session: currentSession }))
    if (flushEffects) {
      await Promise.resolve()
      await Promise.resolve()
    }
  })
  if (!renderer) {
    throw new Error('display-name sync harness did not render')
  }
  return renderer
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function session(accountId: string, sessionExpiresAt: number): MobileSession {
  return {
    accessToken: `access-${accountId}`,
    refreshToken: `refresh-${accountId}`,
    expiresAt: 2_000,
    sessionExpiresAt,
    sessionProfile: 'TRUSTED',
    account: { accountId, displayName: accountId },
    authorityId: 'authority-a'
  }
}

type PendingTask = Readonly<{ runtimeRecordId: string; desiredName: string | null }>

function pendingTask(runtimeRecordId: string, desiredName: string | null): PendingTask {
  return { runtimeRecordId, desiredName }
}

function directoryEntry(): AccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    cloudDisplayName: 'Account A Desk',
    cloudDisplayNameVersion: 3,
    status: 'CLAIMED',
    runtimeVersion: '1.0.0',
    runtimeProtocolVersion: 3,
    capabilities: [],
    resourceVersion: 7,
    createdAt: '2026-09-01T00:00:00Z',
    claimedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    lastHeartbeatAt: null,
    presence: 'ONLINE',
    readiness: 'READY',
    readinessReasonCode: null,
    freeDiskBytes: null,
    connectionCapabilities: []
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}
