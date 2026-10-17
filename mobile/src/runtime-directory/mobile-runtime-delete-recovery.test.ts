import type { AccountRuntimeDirectoryEntry } from './account-runtime-directory-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileSession } from '../auth/mobile-sms-auth'
vi.mock('expo-crypto', () => ({ randomUUID: () => globalThis.crypto.randomUUID() }))
const fixture = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  profiles: vi.fn(),
  clear: vi.fn(),
  retire: vi.fn()
}))
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getAllKeys: async () => [...fixture.storage.keys()],
    getItem: fixture.getItem,
    setItem: fixture.setItem,
    removeItem: fixture.removeItem
  }
}))
vi.mock('../transport/host-list-mutation-queue', () => ({
  hostListMutationsSettled: async () => {}
}))
vi.mock('../transport/host-metadata-store', () => ({
  readStoredHostProfilesForMutation: fixture.profiles
}))
vi.mock('./account-runtime-client-reconciliation', () => ({
  forgetUnlinkedAccountRuntime: fixture.retire
}))
vi.mock('./mobile-runtime-delete-cleanup', () => ({
  clearUnlinkedRuntimeConnections: fixture.clear,
  runtimeDeletionSupportedOnThisSurface: () => true
}))
const session: MobileSession = {
  accessToken: 'secret-access',
  refreshToken: 'secret-refresh',
  authorityId: 'authority',
  account: { accountId: 'account', displayName: 'Account' },
  sessionProfile: 'TRUSTED',
  expiresAt: 1000,
  sessionExpiresAt: 2000
}
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  fixture.storage.clear()
  fixture.getItem.mockImplementation(async (key: string) => fixture.storage.get(key) ?? null)
  fixture.setItem.mockImplementation(async (key: string, raw: string) => {
    fixture.storage.set(key, raw)
  })
  fixture.removeItem.mockImplementation(async (key: string) => {
    fixture.storage.delete(key)
  })
  fixture.profiles.mockResolvedValue([
    { id: 'alias-a', runtimeRecordId: 'runtime', pairingRevision: 'revision-a' },
    { id: 'alias-b', runtimeRecordId: 'runtime' },
    { id: 'unrelated', runtimeRecordId: 'other' }
  ])
})
afterEach(() => {
  vi.restoreAllMocks()
})
describe('durable runtime delete recovery', () => {
  it('persists all aliases without credentials and recovers after module restart and metadata removal', async () => {
    let recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    expect([...fixture.storage.values()].join()).not.toContain('secret')
    fixture.profiles.mockResolvedValue([])
    vi.resetModules()
    recovery = await import('./mobile-runtime-delete-recovery')
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(true)
    expect(await recovery.loadRuntimeDeleteRecoveryAliases('runtime')).toEqual([
      { hostId: 'runtime', pairingRevision: null },
      { hostId: 'alias-a', pairingRevision: 'revision-a' },
      { hostId: 'alias-b', pairingRevision: null }
    ])
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1001)
    expect(fixture.clear).toHaveBeenCalledWith(
      'runtime',
      expect.any(Function),
      expect.any(Function),
      expect.arrayContaining([{ hostId: 'alias-a', pairingRevision: 'revision-a' }])
    )
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(false)
  })
  it('retains journal on cleanup failure and never recovers another account', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    await recovery.recoverRuntimeDeleteConnections(
      { ...session, account: { ...session.account, accountId: 'other' } },
      [],
      vi.fn(),
      () => true
    )
    expect(fixture.clear).not.toHaveBeenCalled()
    fixture.clear.mockRejectedValueOnce(new Error('storage'))
    await expect(
      recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1001)
    ).rejects.toThrow('storage')
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(true)
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1001)
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(false)
  })
  it('keeps recovery pending when a fresh directory still owns the runtime', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    const entry: AccountRuntimeDirectoryEntry = {
      runtimeRecordId: 'runtime',
      status: 'CLAIMED',
      runtimeVersion: '1',
      runtimeProtocolVersion: 3,
      capabilities: [],
      resourceVersion: 1,
      createdAt: 'now',
      claimedAt: 'now',
      updatedAt: 'now',
      lastHeartbeatAt: null,
      presence: 'OFFLINE',
      readiness: 'STOPPED',
      readinessReasonCode: null,
      freeDiskBytes: null,
      connectionCapabilities: []
    }
    await recovery.recoverRuntimeDeleteConnections(session, [entry], vi.fn(), () => true, 1001)
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(true)
  })
  it('stops when the account changes during journal read', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    let current = true
    fixture.getItem.mockImplementationOnce(async (key: string) => {
      current = false
      return fixture.storage.get(key) ?? null
    })
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => current)
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(true)
  })
  it('does not use a directory request that began before or alongside journal preparation', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 999)
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1000)
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(true)
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1001)
    expect(fixture.clear).toHaveBeenCalledOnce()
  })

  it('automatic recovery keeps captured incarnations and isolates account-scoped aliases', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    fixture.profiles.mockResolvedValue([
      { id: 'alias-a', runtimeRecordId: 'runtime', pairingRevision: 'new-pairing' },
      { id: 'new-alias', runtimeRecordId: 'runtime', pairingRevision: 'new-alias-pairing' }
    ])
    const original = await recovery.loadScopedRuntimeDeleteRecoveryAliases(session, 'runtime')
    expect(original).toContainEqual({ hostId: 'alias-a', pairingRevision: 'revision-a' })
    expect(original.some((alias) => alias.hostId === 'new-alias')).toBe(false)
    const other = { ...session, account: { ...session.account, accountId: 'other-account' } }
    await recovery.prepareRuntimeDeleteRecovery(other, 'runtime', 3)
    const newer = await recovery.loadScopedRuntimeDeleteRecoveryAliases(other, 'runtime')
    expect(newer).toContainEqual({ hostId: 'alias-a', pairingRevision: 'new-pairing' })
    await expect(recovery.loadRuntimeDeleteRecoveryAliases('runtime')).rejects.toThrow(
      'runtime_delete_recovery_scope_required'
    )
    fixture.clear.mockClear()
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1001)
    expect(fixture.clear).toHaveBeenCalledWith(
      'runtime',
      expect.any(Function),
      expect.any(Function),
      original
    )
    expect(await recovery.hasRuntimeDeleteRecovery(other, 'runtime')).toBe(true)
  })

  it('a newly confirmed deletion updates current incarnations while retaining absent captured aliases', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    fixture.profiles.mockResolvedValue([
      { id: 'alias-a', runtimeRecordId: 'runtime', pairingRevision: 'new-pairing' },
      { id: 'new-alias', runtimeRecordId: 'runtime', pairingRevision: 'new-alias-pairing' }
    ])
    vi.mocked(Date.now).mockReturnValue(2000)
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    const aliases = await recovery.loadScopedRuntimeDeleteRecoveryAliases(session, 'runtime')
    expect(aliases).toEqual([
      { hostId: 'runtime', pairingRevision: null },
      { hostId: 'alias-a', pairingRevision: 'new-pairing' },
      { hostId: 'alias-b', pairingRevision: null },
      { hostId: 'new-alias', pairingRevision: 'new-alias-pairing' }
    ])
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 1500)
    expect(fixture.clear).not.toHaveBeenCalled()
    await recovery.recoverRuntimeDeleteConnections(session, [], vi.fn(), () => true, 2001)
    expect(fixture.clear).toHaveBeenCalledWith(
      'runtime',
      expect.any(Function),
      expect.any(Function),
      aliases
    )
  })

  it('rejects preparation when storage is unavailable and retains aliases on repeated preparation', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    fixture.setItem.mockRejectedValueOnce(new Error('storage'))
    await expect(recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)).rejects.toThrow(
      'storage'
    )
    expect(fixture.clear).not.toHaveBeenCalled()
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    fixture.profiles.mockResolvedValue([])
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    expect(await recovery.loadRuntimeDeleteRecoveryAliases('runtime')).toEqual([
      { hostId: 'runtime', pairingRevision: null },
      { hostId: 'alias-a', pairingRevision: 'revision-a' },
      { hostId: 'alias-b', pairingRevision: null }
    ])
  })

  it('does not let an older target overwrite or complete a newer deletion task', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    const old = await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    const newer = await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 9)
    await expect(recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)).rejects.toThrow(
      'superseded'
    )
    const confirm = vi.fn(() => true)
    expect(
      await recovery.completeRuntimeDeleteRecovery(session, 'runtime', vi.fn(), () => true, {
        target: old,
        confirmUnlinked: confirm
      })
    ).toBe('superseded')
    expect(confirm).not.toHaveBeenCalled()
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.readRuntimeDeleteRecovery(session, 'runtime')).toMatchObject(newer)
  })

  it('retires an obsolete task without clearing a newly claimed runtime', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    const target = await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    expect(
      await recovery.completeRuntimeDeleteRecovery(session, 'runtime', vi.fn(), () => true, {
        target,
        confirmUnlinked: () => false
      })
    ).toBe('superseded')
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(false)
    // The UI may arrive after background recovery already retired the task.
    expect(
      await recovery.completeRuntimeDeleteRecovery(session, 'runtime', vi.fn(), () => true, {
        target,
        confirmUnlinked: () => false
      })
    ).toBe('superseded')
  })

  it('preserves an unchanged ownership while retiring a task superseded by a newer directory version', async () => {
    const recovery = await import('./mobile-runtime-delete-recovery')
    await recovery.prepareRuntimeDeleteRecovery(session, 'runtime', 3)
    const entry: AccountRuntimeDirectoryEntry = {
      runtimeRecordId: 'runtime',
      resourceVersion: 9,
      status: 'CLAIMED',
      runtimeVersion: '1',
      runtimeProtocolVersion: 3,
      capabilities: [],
      createdAt: 'now',
      claimedAt: 'now',
      updatedAt: 'now',
      lastHeartbeatAt: null,
      presence: 'OFFLINE',
      readiness: 'STOPPED',
      readinessReasonCode: null,
      freeDiskBytes: null,
      connectionCapabilities: []
    }
    await recovery.recoverRuntimeDeleteConnections(session, [entry], vi.fn(), () => true, 1001)
    expect(fixture.clear).not.toHaveBeenCalled()
    expect(await recovery.hasRuntimeDeleteRecovery(session, 'runtime')).toBe(false)
  })
})
