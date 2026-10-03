import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({}))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(1),
  randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
}))

import { MobileApiError } from '../auth/mobile-sms-client'
import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import { AccountRuntimeDisplayNamePendingStore } from './account-runtime-display-name-pending'
import {
  MAXIMUM_PENDING_DISPLAY_NAME_SCOPES,
  MAXIMUM_PENDING_DISPLAY_NAME_TASKS
} from './account-runtime-display-name-pending-schema'
import { retryPendingRuntimeDisplayNames } from './account-runtime-display-name-retry'

const scope = { authorityId: 'hive-primary', accountId: 'account-a' } as const
const runtimeRecordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function memoryStorage() {
  let raw: string | null = null
  return {
    getItem: vi.fn(async () => raw),
    setItem: vi.fn(async (_key: string, value: string) => {
      raw = value
    })
  }
}

function directoryEntry(
  overrides: Partial<AccountRuntimeDirectoryEntry> = {}
): AccountRuntimeDirectoryEntry {
  return {
    runtimeRecordId,
    cloudDisplayName: 'Server name',
    cloudDisplayNameVersion: 4,
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
    connectionCapabilities: [],
    ...overrides
  }
}

async function enqueue(store: AccountRuntimeDisplayNamePendingStore, desiredName = 'Desk') {
  return store.enqueue({
    scope,
    runtimeRecordId,
    desiredName,
    expectedCloudDisplayNameVersion: 3,
    expectedResourceVersion: 7
  })
}

describe('account Runtime display-name pending store', () => {
  it('rejects a new target at capacity but still permits latest-wins replacement', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    for (let index = 0; index < MAXIMUM_PENDING_DISPLAY_NAME_TASKS; index += 1) {
      await store.enqueue({
        scope,
        runtimeRecordId: mobileRuntimeId(index),
        desiredName: `Desk ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }

    await expect(
      store.enqueue({
        scope,
        runtimeRecordId: mobileRuntimeId(MAXIMUM_PENDING_DISPLAY_NAME_TASKS),
        desiredName: 'Overflow',
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    ).rejects.toThrow('runtime_display_name_pending_capacity')
    await expect(store.loadScope(scope)).resolves.toHaveLength(MAXIMUM_PENDING_DISPLAY_NAME_TASKS)

    await expect(
      store.enqueue({
        scope,
        runtimeRecordId: mobileRuntimeId(0),
        desiredName: 'Latest first target',
        expectedCloudDisplayNameVersion: 2,
        expectedResourceVersion: 1
      })
    ).resolves.toMatchObject({ desiredName: 'Latest first target' })
    const tasks = await store.loadScope(scope)
    expect(tasks).toHaveLength(MAXIMUM_PENDING_DISPLAY_NAME_TASKS)
    expect(tasks.at(-1)).toMatchObject({
      runtimeRecordId: mobileRuntimeId(0),
      desiredName: 'Latest first target'
    })
  })

  it('gives each authority and account scope an independent capacity quota', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    for (let index = 0; index < MAXIMUM_PENDING_DISPLAY_NAME_TASKS; index += 1) {
      await store.enqueue({
        scope,
        runtimeRecordId: mobileRuntimeId(index),
        desiredName: `Account A ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }
    const otherScope = { ...scope, accountId: 'account-b' }

    await expect(
      store.enqueue({
        scope: otherScope,
        runtimeRecordId: mobileRuntimeId(MAXIMUM_PENDING_DISPLAY_NAME_TASKS),
        desiredName: 'Account B desk',
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    ).resolves.toMatchObject({ accountId: 'account-b' })
    await expect(store.loadScope(scope)).resolves.toHaveLength(MAXIMUM_PENDING_DISPLAY_NAME_TASKS)
    await expect(store.loadScope(otherScope)).resolves.toHaveLength(1)
  })

  it('fails closed without overwriting when persisted state cannot be read', async () => {
    const storage = {
      getItem: vi.fn().mockRejectedValue(new Error('storage unavailable')),
      setItem: vi.fn()
    }
    const store = new AccountRuntimeDisplayNamePendingStore(storage)

    await expect(enqueue(store)).rejects.toThrow('runtime_display_name_pending_read_failed')
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('distinguishes corrupt persisted state from a missing queue and does not overwrite it', async () => {
    const corruptRaw = '{not-json'
    const storage = {
      getItem: vi.fn().mockResolvedValue(corruptRaw),
      setItem: vi.fn()
    }
    const store = new AccountRuntimeDisplayNamePendingStore(storage)

    await expect(enqueue(store)).rejects.toThrow('runtime_display_name_pending_invalid')
    expect(storage.setItem).not.toHaveBeenCalled()
    await expect(storage.getItem('unchanged')).resolves.toBe(corruptRaw)

    const missingStorage = memoryStorage()
    await expect(
      enqueue(new AccountRuntimeDisplayNamePendingStore(missingStorage))
    ).resolves.toEqual(expect.objectContaining({ desiredName: 'Desk' }))
    expect(missingStorage.setItem).toHaveBeenCalledOnce()
  })

  it('fails closed at the persisted scope bound without changing the existing JSON', async () => {
    const storage = memoryStorage()
    const store = new AccountRuntimeDisplayNamePendingStore(storage)
    for (let index = 0; index < MAXIMUM_PENDING_DISPLAY_NAME_SCOPES; index += 1) {
      await store.enqueue({
        scope: { ...scope, accountId: `account-${index}` },
        runtimeRecordId: mobileRuntimeId(index),
        desiredName: `Scope ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }
    const rawBefore = await storage.getItem('ignored')

    await expect(
      store.enqueue({
        scope: { ...scope, accountId: 'overflow-account' },
        runtimeRecordId: mobileRuntimeId(MAXIMUM_PENDING_DISPLAY_NAME_SCOPES),
        desiredName: 'Overflow scope',
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    ).rejects.toThrow('runtime_display_name_pending_scope_capacity')
    await expect(storage.getItem('ignored')).resolves.toBe(rawBefore)
  })

  it('persists by authority, account, and Runtime while the newest edit wins', async () => {
    const storage = memoryStorage()
    const store = new AccountRuntimeDisplayNamePendingStore(storage)

    await enqueue(store, 'First')
    const latest = await enqueue(store, ' Café ')
    await store.enqueue({
      scope: { ...scope, accountId: 'account-b' },
      runtimeRecordId,
      desiredName: 'Other account',
      expectedCloudDisplayNameVersion: 1,
      expectedResourceVersion: 2
    })

    await expect(store.loadScope(scope)).resolves.toEqual([
      expect.objectContaining({ desiredName: 'Café', revision: latest.revision })
    ])
    await expect(store.loadScope({ ...scope, accountId: 'account-b' })).resolves.toHaveLength(1)
  })

  it('refetches one conflict and retries only within the same ownership epoch', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)
    const patch = vi
      .fn()
      .mockRejectedValueOnce(new MobileApiError('conflict', 409, undefined, false))
      .mockResolvedValueOnce({ cloudDisplayNameVersion: 6 })

    await expect(
      retryPendingRuntimeDisplayNames({
        store,
        scope,
        currentScope: () => scope,
        patch,
        refetch: vi.fn().mockResolvedValue(directoryEntry({ cloudDisplayNameVersion: 5 }))
      })
    ).resolves.toEqual({ changed: true, directoryRefreshRequired: false })
    expect(patch.mock.calls).toEqual([
      [runtimeRecordId, 'Desk', 3],
      [runtimeRecordId, 'Desk', 5]
    ])
    await expect(store.loadScope(scope)).resolves.toEqual([
      expect.objectContaining({ desiredName: 'Desk', dormant: true, confirmed: true })
    ])
  })

  it('drops a conflicted task when resourceVersion proves unlink or reclaim', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)
    const patch = vi.fn().mockRejectedValue(new MobileApiError('conflict', 409, undefined, false))

    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch,
      refetch: vi.fn().mockResolvedValue(directoryEntry({ resourceVersion: 8 }))
    })

    expect(patch).toHaveBeenCalledTimes(1)
    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('refreshes the directory when conflict refetch shows alias support is unavailable', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)

    await expect(
      retryPendingRuntimeDisplayNames({
        store,
        scope,
        currentScope: () => scope,
        patch: vi.fn().mockRejectedValue(new MobileApiError('conflict', 409, undefined, false)),
        refetch: vi.fn().mockResolvedValue(directoryEntry({ cloudDisplayNameVersion: undefined }))
      })
    ).resolves.toEqual({ changed: false, directoryRefreshRequired: true })
    expect((await store.loadScope(scope))[0]).toMatchObject({ dormant: true })
  })

  it('keeps a pending edit across an ordinary directory resourceVersion change', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)

    await store.reconcileDirectory(scope, [directoryEntry({ resourceVersion: 8 })])

    await expect(store.loadScope(scope)).resolves.toEqual([
      expect.objectContaining({
        expectedResourceVersion: 7,
        expectedCloudDisplayNameVersion: 3,
        desiredName: 'Desk'
      })
    ])
  })

  it('preserves the old alias fence when directory sees reclaim before retry', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)
    await store.reconcileDirectory(scope, [
      directoryEntry({ resourceVersion: 8, cloudDisplayNameVersion: 9 })
    ])
    const patch = vi.fn().mockRejectedValue(new MobileApiError('conflict', 409, undefined, false))

    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch,
      refetch: vi
        .fn()
        .mockResolvedValue(directoryEntry({ resourceVersion: 8, cloudDisplayNameVersion: 9 }))
    })

    expect(patch).toHaveBeenCalledTimes(1)
    expect(patch).toHaveBeenCalledWith(runtimeRecordId, 'Desk', 3)
    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('keeps the accepted overlay until a directory response confirms the new alias', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store, 'Accepted name')

    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch: vi.fn().mockResolvedValue({ cloudDisplayNameVersion: 4 }),
      refetch: vi.fn()
    })

    expect((await store.loadScope(scope))[0]).toMatchObject({
      desiredName: 'Accepted name',
      confirmed: true,
      dormant: true,
      confirmedCloudDisplayNameVersion: 4
    })
    await store.reconcileDirectory(scope, [
      directoryEntry({ cloudDisplayName: 'Accepted name', cloudDisplayNameVersion: 4 })
    ])
    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('persists a successful retry pass with one batched storage write', async () => {
    const storage = memoryStorage()
    const store = new AccountRuntimeDisplayNamePendingStore(storage)
    for (let index = 0; index < MAXIMUM_PENDING_DISPLAY_NAME_TASKS; index += 1) {
      await store.enqueue({
        scope,
        runtimeRecordId: mobileRuntimeId(index),
        desiredName: `Desk ${index}`,
        expectedCloudDisplayNameVersion: 1,
        expectedResourceVersion: 1
      })
    }
    storage.getItem.mockClear()
    storage.setItem.mockClear()
    const patch = vi.fn().mockResolvedValue({ cloudDisplayNameVersion: 2 })

    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch,
      refetch: vi.fn()
    })

    expect(patch).toHaveBeenCalledTimes(MAXIMUM_PENDING_DISPLAY_NAME_TASKS)
    expect(storage.getItem).toHaveBeenCalledTimes(MAXIMUM_PENDING_DISPLAY_NAME_TASKS + 2)
    expect(storage.setItem).toHaveBeenCalledOnce()
  })

  it('keeps a confirmed overlay for stale directory versions and clears it after overwrite', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store, 'Accepted name')
    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch: vi.fn().mockResolvedValue({ cloudDisplayNameVersion: 6 }),
      refetch: vi.fn()
    })

    await store.reconcileDirectory(scope, [
      directoryEntry({ cloudDisplayName: 'Old name', cloudDisplayNameVersion: 5 })
    ])
    await expect(store.loadScope(scope)).resolves.toHaveLength(1)
    await store.reconcileDirectory(scope, [
      directoryEntry({ cloudDisplayName: 'Other device', cloudDisplayNameVersion: 6 })
    ])
    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('clears a confirmed overlay when directory proves a later ownership epoch', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store, 'Accepted name')
    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch: vi.fn().mockResolvedValue({ cloudDisplayNameVersion: 4 }),
      refetch: vi.fn()
    })

    await store.reconcileDirectory(scope, [
      directoryEntry({
        resourceVersion: 8,
        cloudDisplayName: 'Reclaimed Runtime',
        cloudDisplayNameVersion: 5
      })
    ])

    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('runs the latest revision in a trailing pass when it is enqueued in flight', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store, 'First name')
    let resolveFirst!: (value: { cloudDisplayNameVersion: number }) => void
    const firstPatch = new Promise<{ cloudDisplayNameVersion: number }>((resolve) => {
      resolveFirst = resolve
    })
    const patch = vi
      .fn()
      .mockReturnValueOnce(firstPatch)
      .mockResolvedValueOnce({ cloudDisplayNameVersion: 5 })
    const firstFlight = retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch,
      refetch: vi.fn()
    })
    await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(1))

    await enqueue(store, 'Latest name')
    const trailingFlight = retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => scope,
      patch,
      refetch: vi.fn()
    })
    expect(trailingFlight).toBe(firstFlight)
    resolveFirst({ cloudDisplayNameVersion: 4 })
    await trailingFlight

    expect(patch.mock.calls.map((call) => call[1])).toEqual(['First name', 'Latest name'])
    expect((await store.loadScope(scope))[0]).toMatchObject({
      desiredName: 'Latest name',
      confirmed: true
    })
  })

  it('keeps a 404 dormant through feature rollback and clears only after a successful directory proof', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)
    const patch = vi.fn().mockRejectedValue(new MobileApiError('not found', 404, undefined, false))

    await expect(
      retryPendingRuntimeDisplayNames({
        store,
        scope,
        currentScope: () => scope,
        patch,
        refetch: vi.fn()
      })
    ).resolves.toEqual({ changed: false, directoryRefreshRequired: true })
    expect((await store.loadScope(scope))[0]).toMatchObject({ dormant: true })

    await store.reconcileDirectory(scope, [directoryEntry({ cloudDisplayNameVersion: undefined })])
    expect((await store.loadScope(scope))[0]).toMatchObject({ dormant: true })
    await store.reconcileDirectory(scope, [directoryEntry({ cloudDisplayNameVersion: 6 })])
    expect((await store.loadScope(scope))[0]).toMatchObject({
      dormant: false,
      confirmed: false,
      expectedCloudDisplayNameVersion: 6
    })
    await store.reconcileDirectory(scope, [])
    await expect(store.loadScope(scope)).resolves.toEqual([])
  })

  it('never sends a task after the current account scope changes', async () => {
    const store = new AccountRuntimeDisplayNamePendingStore(memoryStorage())
    await enqueue(store)
    const patch = vi.fn()

    await retryPendingRuntimeDisplayNames({
      store,
      scope,
      currentScope: () => ({ ...scope, accountId: 'account-b' }),
      patch,
      refetch: vi.fn()
    })

    expect(patch).not.toHaveBeenCalled()
    await expect(store.loadScope(scope)).resolves.toHaveLength(1)
  })
})

function mobileRuntimeId(index: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`
}
