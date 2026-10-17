import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({
  aliases: vi.fn(),
  profiles: vi.fn(),
  remove: vi.fn(),
  home: vi.fn(),
  worktrees: vi.fn(),
  repos: vi.fn(),
  read: vi.fn(),
  persist: vi.fn(),
  notify: vi.fn()
}))
vi.mock('./mobile-runtime-delete-recovery', () => ({
  loadRuntimeDeleteRecoveryAliases: fixture.aliases
}))
vi.mock('../transport/host-list-mutation-queue', () => ({
  hostListMutationsSettled: async () => {}
}))
vi.mock('../transport/host-metadata-store', () => ({
  readStoredHostProfilesForMutation: fixture.profiles
}))
vi.mock('../transport/host-removal-lifecycle', () => ({ removeHostAndCloseClient: fixture.remove }))
vi.mock('../cache/home-snapshot-cache', () => ({ clearHostHomeSnapshot: fixture.home }))
vi.mock('../cache/worktree-cache', () => ({ clearCachedWorktrees: fixture.worktrees }))
vi.mock('../cache/repo-cache', () => ({ clearCachedRepos: fixture.repos }))
vi.mock('../storage/mirrored-storage-keys', () => ({
  readMirroredKeyOrStore: fixture.read,
  persistMirrored: fixture.persist
}))
vi.mock('./local-runtime-connections-changed', () => ({
  notifyLocalRuntimeConnectionsChanged: fixture.notify
}))
import {
  clearUnlinkedRuntimeConnections,
  runtimeDeletionSupportedOnThisSurface
} from './mobile-runtime-delete-cleanup'
import {
  runtimeDeletionSupportedOnThisSurface as webSupported,
  clearUnlinkedRuntimeConnections as webClear
} from './mobile-runtime-delete-cleanup.web'

describe('unlinked runtime connection cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fixture.aliases.mockResolvedValue([])
    fixture.aliases.mockImplementation(async (id) => [{ hostId: id, pairingRevision: null }])
    fixture.read.mockResolvedValue(null)
    fixture.remove.mockImplementation(async (id, forget, _revision, afterRemoval) => {
      forget(id)
      await afterRemoval?.()
      return true
    })
  })
  it('cleans canonical account-only clients and refuses embedded pages', async () => {
    const forget = vi.fn()
    await clearUnlinkedRuntimeConnections('account-only', forget, () => true)
    expect(forget).toHaveBeenCalledWith('account-only')
    expect(fixture.remove).toHaveBeenCalledWith('account-only', forget, null, expect.any(Function))
    expect(runtimeDeletionSupportedOnThisSurface()).toBe(true)
    expect(webSupported()).toBe(false)
    await expect(webClear('id', forget, () => true)).rejects.toThrow(
      'runtime_deletion_requires_native_app'
    )
  })
  it('removes every runtime alias while preserving unrelated hosts and history', async () => {
    fixture.aliases.mockResolvedValue([
      { hostId: 'runtime', pairingRevision: null },
      { hostId: 'a', pairingRevision: 'revision-a' },
      { hostId: 'b', pairingRevision: 'revision-b' }
    ])
    fixture.read.mockResolvedValue(JSON.stringify({ hostId: 'other', worktreeId: 'repo:tree' }))
    await clearUnlinkedRuntimeConnections('runtime', vi.fn(), () => true)
    expect(fixture.remove.mock.calls.map(([id]) => id)).toEqual(['runtime', 'a', 'b'])
    expect(fixture.home.mock.calls.map(([id]) => id)).toEqual(['runtime', 'a', 'b'])
    expect(fixture.persist).not.toHaveBeenCalled()
  })
  it('retries aliases whose cache cleanup failed after metadata removal', async () => {
    fixture.aliases.mockResolvedValue([
      { hostId: 'retry', pairingRevision: null },
      { hostId: 'retry-alias', pairingRevision: 'old' }
    ])
    fixture.home.mockImplementation(async (id) => {
      if (id === 'retry-alias') {
        throw new Error('storage')
      }
    })
    await expect(clearUnlinkedRuntimeConnections('retry', vi.fn(), () => true)).rejects.toThrow(
      'storage'
    )
    fixture.home.mockResolvedValue(undefined)
    fixture.remove.mockClear()
    await clearUnlinkedRuntimeConnections('retry', vi.fn(), () => true)
    expect(fixture.remove.mock.calls.map(([id]) => id)).toEqual(['retry', 'retry-alias'])
  })
  it('propagates unreadable storage and stops when the account changes during a read', async () => {
    fixture.aliases.mockRejectedValueOnce(new Error('storage unreadable'))
    await expect(clearUnlinkedRuntimeConnections('failed', vi.fn(), () => true)).rejects.toThrow(
      'storage unreadable'
    )
    let current = true
    fixture.aliases.mockImplementationOnce(async () => {
      current = false
      return [{ id: 'a', runtimeRecordId: 'stale' }]
    })
    await expect(clearUnlinkedRuntimeConnections('stale', vi.fn(), () => current)).rejects.toThrow(
      'mobile_session_required'
    )
    expect(fixture.remove).not.toHaveBeenCalled()
  })
  it('serializes competing cleanup and rechecks each callers own account scope', async () => {
    let resolve!: (profiles: unknown[]) => void
    fixture.aliases.mockReturnValueOnce(
      new Promise<unknown[]>((done) => {
        resolve = done
      })
    )
    const first = clearUnlinkedRuntimeConnections('concurrent', vi.fn(), () => true)
    const second = clearUnlinkedRuntimeConnections('concurrent', vi.fn(), () => false)
    const rejected = expect(second).rejects.toThrow('mobile_session_required')
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.aliases).toHaveBeenCalledOnce()
    resolve([{ hostId: 'concurrent', pairingRevision: null }])
    await first
    await rejected
    expect(fixture.aliases).toHaveBeenCalledOnce()
    expect(fixture.remove).toHaveBeenCalledOnce()
  })

  it('preserves a later pairing incarnation and its caches and does not enumerate new aliases', async () => {
    fixture.aliases.mockResolvedValue([{ hostId: 'old-alias', pairingRevision: 'old-revision' }])
    fixture.remove.mockResolvedValue(false)
    const forget = vi.fn()
    await clearUnlinkedRuntimeConnections('runtime', forget, () => true)
    expect(fixture.remove).toHaveBeenCalledWith(
      'old-alias',
      forget,
      'old-revision',
      expect.any(Function)
    )
    expect(forget).not.toHaveBeenCalled()
    expect(fixture.profiles).not.toHaveBeenCalled()
    expect(fixture.home).not.toHaveBeenCalled()
    expect(fixture.notify).not.toHaveBeenCalled()
  })

  it('clears matching last visited history and checks scope before starting', async () => {
    fixture.read.mockResolvedValue(JSON.stringify({ hostId: 'history', worktreeId: 'repo:tree' }))
    await clearUnlinkedRuntimeConnections('history', vi.fn(), () => true)
    expect(fixture.persist).toHaveBeenCalledWith('orca:last-visited-worktree', null)
    const forget = vi.fn()
    await expect(clearUnlinkedRuntimeConnections('history', forget, () => false)).rejects.toThrow(
      'mobile_session_required'
    )
    expect(forget).not.toHaveBeenCalled()
  })
})
