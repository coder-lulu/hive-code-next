import { beforeEach, describe, expect, it, vi } from 'vitest'

const removeHostMock = vi.hoisted(() => vi.fn())
const asyncStorage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  // Why removeItem is here: clearWatermark() swallows its own failures, so a mock
  // missing this method turns the persisted-watermark cleanup into a caught
  // TypeError — the assertion below would pass even if the call were deleted.
  removeItem: vi.fn(async () => undefined)
}))

vi.mock('@react-native-async-storage/async-storage', () => ({ default: asyncStorage }))
const forgetHostDescriptorMock = vi.hoisted(() => vi.fn())
const forgetUpdateFailuresMock = vi.hoisted(() => vi.fn(async () => undefined))
const deletePageCacheMock = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('./host-store', () => ({
  removeHost: (...args: unknown[]) => removeHostMock(...args)
}))

vi.mock('./host-descriptor-store', () => ({
  forgetHostDescriptor: (hostId: string) => forgetHostDescriptorMock(hostId)
}))

vi.mock('../mobile-web-shell/removed-host-shell-cache', () => ({
  forgetHostUpdateFailures: (hostId: string) => forgetUpdateFailuresMock(hostId),
  deleteHostPageCache: (hostId: string) => deletePageCacheMock(hostId)
}))

import { removeHostAndCloseClient } from './host-removal-lifecycle'
import {
  getHostNotificationSession,
  resetHostNotificationSessionsForTests
} from '../notifications/notification-reconnect-catchup'

describe('host removal lifecycle', () => {
  beforeEach(() => {
    removeHostMock.mockReset()
    asyncStorage.removeItem.mockClear()
    resetHostNotificationSessionsForTests()
    forgetHostDescriptorMock.mockClear()
    forgetUpdateFailuresMock.mockClear()
    deletePageCacheMock.mockClear()
  })

  it('closes the client only after metadata removal commits', async () => {
    let commitRemoval: (() => void) | null = null
    removeHostMock.mockReturnValue(
      new Promise<void>((resolve) => {
        commitRemoval = resolve
      })
    )
    const closeHostClient = vi.fn()

    const removal = removeHostAndCloseClient('host-1', closeHostClient)
    expect(closeHostClient).not.toHaveBeenCalled()
    commitRemoval?.()
    await removal

    expect(closeHostClient).toHaveBeenCalledWith('host-1')
  })

  it('keeps the client open when metadata removal fails', async () => {
    removeHostMock.mockRejectedValue(new Error('storage unavailable'))
    const closeHostClient = vi.fn()

    await expect(removeHostAndCloseClient('host-1', closeHostClient)).rejects.toThrow(
      'storage unavailable'
    )
    expect(closeHostClient).not.toHaveBeenCalled()
  })

  it('preserves client and caches when a later pairing replaced the deletion target', async () => {
    removeHostMock.mockResolvedValue(false)
    const closeHostClient = vi.fn()
    await expect(removeHostAndCloseClient('host-1', closeHostClient, 'old-revision')).resolves.toBe(
      false
    )
    expect(removeHostMock).toHaveBeenCalledWith('host-1', 'old-revision', expect.any(Function))
    expect(closeHostClient).not.toHaveBeenCalled()
    expect(deletePageCacheMock).not.toHaveBeenCalled()
    expect(forgetHostDescriptorMock).not.toHaveBeenCalled()
    expect(asyncStorage.removeItem).not.toHaveBeenCalled()
  })

  it('updates mounted catalogs after metadata commits even when page-cache cleanup fails', async () => {
    removeHostMock.mockImplementation(async (_id, _revision, afterCommit: () => Promise<void>) => {
      await afterCommit()
      return true
    })
    deletePageCacheMock.mockRejectedValueOnce(new Error('page cache unavailable'))
    const closeHostClient = vi.fn()
    const afterRemoval = vi.fn()
    await expect(
      removeHostAndCloseClient('host-1', closeHostClient, 'revision', afterRemoval)
    ).rejects.toThrow('page cache unavailable')
    expect(afterRemoval).toHaveBeenCalledOnce()
    expect(closeHostClient.mock.invocationCallOrder[0]).toBeLessThan(
      afterRemoval.mock.invocationCallOrder[0]!
    )
  })

  it('holds the metadata mutation until failed native cleanup and catalog cleanup both settle', async () => {
    let rejectNative!: (error: Error) => void
    let finishCatalog!: () => void
    const nativeCleanup = new Promise<void>((_resolve, reject) => {
      rejectNative = reject
    })
    const catalogCleanup = new Promise<void>((resolve) => {
      finishCatalog = resolve
    })
    let queueReleased = false
    removeHostMock.mockImplementation(async (_id, _revision, afterCommit: () => Promise<void>) => {
      try {
        await afterCommit()
        return true
      } finally {
        queueReleased = true
      }
    })
    deletePageCacheMock.mockReturnValueOnce(nativeCleanup)
    const afterRemoval = vi.fn(() => catalogCleanup)
    const removal = removeHostAndCloseClient('host-1', vi.fn(), 'revision', afterRemoval)
    const result = removal.catch((failure: unknown) => failure)
    await Promise.resolve()
    expect(afterRemoval).toHaveBeenCalledOnce()
    rejectNative(new Error('native cleanup failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(queueReleased).toBe(false)
    finishCatalog()
    expect(await result).toEqual(new Error('native cleanup failed'))
    expect(queueReleased).toBe(true)
  })

  it('waits for native cleanup when catalog cleanup throws synchronously', async () => {
    let finishNative!: () => void
    const nativeCleanup = new Promise<void>((resolve) => {
      finishNative = resolve
    })
    let queueReleased = false
    removeHostMock.mockImplementation(async (_id, _revision, afterCommit: () => Promise<void>) => {
      try {
        await afterCommit()
        return true
      } finally {
        queueReleased = true
      }
    })
    deletePageCacheMock.mockReturnValueOnce(nativeCleanup)
    const afterRemoval = vi.fn(() => {
      throw new Error('catalog failed')
    })
    const result = removeHostAndCloseClient('host-1', vi.fn(), 'revision', afterRemoval).catch(
      (failure: unknown) => failure
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(afterRemoval).toHaveBeenCalledOnce()
    expect(queueReleased).toBe(false)
    finishNative()
    expect(await result).toEqual(new Error('catalog failed'))
    expect(queueReleased).toBe(true)
  })

  it('does not notify catalog cleanup when metadata fails or a newer pairing is preserved', async () => {
    const afterRemoval = vi.fn()
    removeHostMock.mockRejectedValueOnce(new Error('metadata failed')).mockResolvedValueOnce(false)
    await expect(
      removeHostAndCloseClient('host-1', vi.fn(), 'revision', afterRemoval)
    ).rejects.toThrow('metadata failed')
    await expect(
      removeHostAndCloseClient('host-1', vi.fn(), 'revision', afterRemoval)
    ).resolves.toBe(false)
    expect(afterRemoval).not.toHaveBeenCalled()
  })

  it('retires the notification session so a removed host leaves nothing behind', async () => {
    // Round-1 review finding: the session lives at module scope (it must survive the
    // subscription teardown a reconnect performs), so removal is the only thing that
    // can retire it. Left behind, each remove/re-pair cycle strands a session plus up
    // to 512 seen keys, and a re-paired host inherits a watermark it never earned.
    removeHostMock.mockResolvedValue(undefined)
    const session = getHostNotificationSession('host-1')
    session.lastDeliveredSeq = 42
    session.lastDeliveredEpoch = 'epoch-A'

    await removeHostAndCloseClient('host-1', vi.fn())

    // A fresh session for the same id — not the retained one.
    const afterRemoval = getHostNotificationSession('host-1')
    expect(afterRemoval).not.toBe(session)
    expect(afterRemoval.lastDeliveredSeq).toBe(0)
    expect(afterRemoval.lastDeliveredEpoch).toBeNull()
  })

  it('erases the persisted watermark, not just the in-memory session', async () => {
    // Why separately from the test above: the session is process-local, the
    // watermark is not. Retiring only the session lets a re-pair of the same host
    // read the old seq off disk and resume against a counter it never saw — the
    // catch-up would then start above the real cut and drop everything below it.
    removeHostMock.mockResolvedValue(undefined)

    await removeHostAndCloseClient('host-1', vi.fn())
    // clearWatermark is fire-and-forget; let its microtask land.
    await Promise.resolve()

    expect(asyncStorage.removeItem).toHaveBeenCalledWith('orca:mobileNotificationsWatermark:host-1')
  })

  it('forgets the removed host descriptor', async () => {
    removeHostMock.mockResolvedValue(undefined)
    await removeHostAndCloseClient('host-1', vi.fn())
    expect(forgetHostDescriptorMock).toHaveBeenCalledWith('host-1')
  })

  it("forgets the host's recorded update failures once it is gone", async () => {
    removeHostMock.mockResolvedValue(undefined)
    await removeHostAndCloseClient('host-1', vi.fn())
    expect(forgetUpdateFailuresMock).toHaveBeenCalledWith('host-1')
  })

  it('keeps them while the host is still paired', async () => {
    removeHostMock.mockRejectedValue(new Error('storage unavailable'))
    await expect(removeHostAndCloseClient('host-1', vi.fn())).rejects.toThrow()
    expect(forgetUpdateFailuresMock).not.toHaveBeenCalled()
  })

  it('still closes the client when forgetting them fails', async () => {
    removeHostMock.mockResolvedValue(undefined)
    forgetUpdateFailuresMock.mockRejectedValueOnce(new Error('disk'))
    const closeHostClient = vi.fn()
    await removeHostAndCloseClient('host-1', closeHostClient)
    expect(closeHostClient).toHaveBeenCalledWith('host-1')
  })

  it("deletes the host's page cache once it is gone, and keeps it while it is still paired", async () => {
    removeHostMock.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(removeHostAndCloseClient('host-1', vi.fn())).rejects.toThrow()
    expect(deletePageCacheMock).not.toHaveBeenCalled()
    removeHostMock.mockResolvedValue(undefined)
    await removeHostAndCloseClient('host-1', vi.fn())
    expect(deletePageCacheMock).toHaveBeenCalledWith('host-1')
    expect(removeHostMock.mock.invocationCallOrder.at(-1)).toBeLessThan(
      deletePageCacheMock.mock.invocationCallOrder[0]
    )
  })

  it('still removes the host when its page cache cannot be deleted', async () => {
    removeHostMock.mockResolvedValue(undefined)
    deletePageCacheMock.mockRejectedValueOnce(new Error('disk'))
    const closeHostClient = vi.fn()
    await expect(removeHostAndCloseClient('host-1', closeHostClient)).resolves.toBeUndefined()
    expect(closeHostClient).toHaveBeenCalledWith('host-1')
  })
})
