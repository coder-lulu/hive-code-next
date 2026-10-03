import { describe, expect, it, vi } from 'vitest'
import { AccountRuntimeDirectoryStore } from './account-runtime-directory-store'
import {
  RuntimePresenceEntrySchema,
  type AccountRuntimeDirectoryEntry
} from './account-runtime-directory-types'

const runtime = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  status: 'CLAIMED',
  runtimeVersion: '1.0.0',
  runtimeProtocolVersion: 3,
  capabilities: [],
  resourceVersion: 1,
  createdAt: '2026-08-31T00:00:00Z',
  claimedAt: '2026-08-31T00:00:00Z',
  updatedAt: '2026-08-31T00:00:00Z',
  lastHeartbeatAt: null,
  presence: 'OFFLINE',
  readiness: 'STOPPED',
  readinessReasonCode: null,
  freeDiskBytes: null,
  connectionCapabilities: []
} satisfies AccountRuntimeDirectoryEntry

describe('AccountRuntimeDirectoryStore', () => {
  it('reuses successful directory and presence reads until their own expiry', () => {
    const store = new AccountRuntimeDirectoryStore()
    const scope = { authorityId: 'authority', accountId: 'account-a' }
    const generation = store.activate(scope)
    store.complete(generation, [runtime], 1_000)
    expect(store.isDirectoryFresh(scope, 300_999)).toBe(true)
    expect(store.isDirectoryFresh(scope, 301_000)).toBe(false)
    expect(store.isDirectoryFresh({ ...scope, accountId: 'other' }, 2_000)).toBe(false)
    expect(store.stalePresenceIds(30_999)).toEqual([])
    expect(store.stalePresenceIds(31_000)).toEqual([runtime.runtimeRecordId])
    store.updatePresence(generation, 1, [{ ...runtime, observedAt: 'now' }], 31_000)
    expect(store.stalePresenceIds(31_001)).toEqual([])
    store.clear()
    expect(store.isDirectoryFresh(scope, 31_002)).toBe(false)
  })

  it('does not renew freshness for failures, rejected generations or missing presence rows', () => {
    const store = new AccountRuntimeDirectoryStore()
    const scope = { authorityId: 'authority', accountId: 'account-a' }
    const generation = store.activate(scope)
    store.complete(generation, [runtime], 1_000)
    store.updatePresence(generation, 1, [], 31_000)
    store.updatePresence(generation - 1, 2, [{ ...runtime, observedAt: 'now' }], 31_000)
    expect(store.stalePresenceIds(31_001)).toEqual([runtime.runtimeRecordId])
    store.fail(generation, 'offline')
    expect(store.isDirectoryFresh(scope, 2_000)).toBe(false)
    expect(store.isDirectoryFresh(scope, 0)).toBe(false)
  })

  it('keeps same-account rows during refresh and clears them on account switch', () => {
    const store = new AccountRuntimeDirectoryStore()
    const first = store.activate({ authorityId: 'authority', accountId: 'account-a' })
    store.complete(first, [runtime], 10)

    store.activate({ authorityId: 'authority', accountId: 'account-a' })
    expect(store.getSnapshot()).toMatchObject({ status: 'refreshing', entries: [runtime] })

    store.activate({ authorityId: 'authority', accountId: 'account-b' })
    expect(store.getSnapshot()).toMatchObject({ status: 'loading', entries: [] })
  })

  it('fences a late response from a signed-out generation', () => {
    const store = new AccountRuntimeDirectoryStore()
    const generation = store.activate({ authorityId: 'authority', accountId: 'account-a' })
    const listener = vi.fn()
    store.subscribe(listener)

    store.clear()
    store.complete(generation, [runtime], 10)

    expect(store.getSnapshot()).toMatchObject({ scope: null, status: 'idle', entries: [] })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('ignores an older concurrent presence response and avoids no-op publications', () => {
    const store = new AccountRuntimeDirectoryStore()
    const generation = store.activate({ authorityId: 'authority', accountId: 'account-a' })
    store.complete(generation, [runtime], 10)
    const listener = vi.fn()
    store.subscribe(listener)

    store.updatePresence(generation, 2, [
      {
        runtimeRecordId: runtime.runtimeRecordId,
        presence: 'ONLINE',
        lastHeartbeatAt: '2026-08-31T00:00:30Z',
        readiness: 'READY',
        readinessReasonCode: null,
        freeDiskBytes: 1,
        observedAt: '2026-08-31T00:00:31Z'
      }
    ])
    store.updatePresence(generation, 1, [
      {
        runtimeRecordId: runtime.runtimeRecordId,
        presence: 'OFFLINE',
        lastHeartbeatAt: null,
        readiness: 'STOPPED',
        readinessReasonCode: null,
        freeDiskBytes: null,
        observedAt: null
      }
    ])
    store.updatePresence(generation, 3, [
      {
        runtimeRecordId: runtime.runtimeRecordId,
        presence: 'ONLINE',
        lastHeartbeatAt: '2026-08-31T00:00:30Z',
        readiness: 'READY',
        readinessReasonCode: null,
        freeDiskBytes: 1,
        observedAt: '2026-08-31T00:00:31Z'
      }
    ])

    expect(store.getSnapshot().entries[0]).toMatchObject({
      presence: 'ONLINE',
      readiness: 'READY',
      freeDiskBytes: 1
    })
    expect(listener).toHaveBeenCalledOnce()
  })

  it('accepts the minimal OFFLINE presence response emitted by the service', () => {
    expect(
      RuntimePresenceEntrySchema.parse({
        runtimeRecordId: runtime.runtimeRecordId,
        presence: 'OFFLINE'
      })
    ).toEqual({
      runtimeRecordId: runtime.runtimeRecordId,
      presence: 'OFFLINE',
      lastHeartbeatAt: null,
      readiness: 'STOPPED',
      readinessReasonCode: null,
      freeDiskBytes: null,
      observedAt: null
    })
  })
})
