import { beforeEach, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }))
beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
})
it('purges only the removed host and cancels a pending snapshot write', async () => {
  vi.useFakeTimers()
  const cache = await import('./home-snapshot-cache')
  storage.getItem.mockResolvedValueOnce(
    JSON.stringify({
      worktreeInfo: { removed: {}, kept: {} },
      accountsByHost: { removed: {}, kept: {} },
      savedAt: 1
    })
  )
  const snapshot = await cache.loadHomeSnapshot()
  if (!snapshot) {
    throw new Error('snapshot missing')
  }
  cache.saveHomeSnapshot(snapshot)
  await cache.clearHostHomeSnapshot('removed')
  await vi.runAllTimersAsync()
  expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1])).toEqual({
    worktreeInfo: { kept: {} },
    accountsByHost: { kept: {} },
    savedAt: 1
  })
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  vi.useRealTimers()
})
it('reports persistent storage failure and guards account changes after reads', async () => {
  const cache = await import('./home-snapshot-cache')
  storage.getItem.mockRejectedValueOnce(new Error('storage'))
  await expect(cache.clearHostHomeSnapshot('host')).rejects.toThrow('storage')
  storage.getItem.mockResolvedValueOnce(JSON.stringify({ worktreeInfo: {}, accountsByHost: {} }))
  await expect(cache.clearHostHomeSnapshot('host', () => false)).rejects.toThrow(
    'mobile_session_required'
  )
  expect(storage.setItem).not.toHaveBeenCalled()
})

it('discards malformed derived snapshots without making cleanup permanently fail', async () => {
  const cache = await import('./home-snapshot-cache')
  storage.getItem.mockResolvedValueOnce('{broken')
  await cache.clearHostHomeSnapshot('host')
  expect(storage.removeItem).toHaveBeenCalledWith('orca:home-snapshot:v1')
})
it('does not resurrect a snapshot read started before cleanup', async () => {
  const cache = await import('./home-snapshot-cache')
  let resolve!: (raw: string) => void
  storage.getItem.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done
    })
  )
  const loading = cache.loadHomeSnapshot()
  storage.getItem.mockResolvedValueOnce(
    JSON.stringify({ worktreeInfo: { removed: {}, kept: {} }, accountsByHost: {}, savedAt: 1 })
  )
  await cache.clearHostHomeSnapshot('removed')
  resolve(JSON.stringify({ worktreeInfo: { removed: {} }, accountsByHost: {}, savedAt: 0 }))
  expect(await loading).toEqual({ worktreeInfo: { kept: {} }, accountsByHost: {}, savedAt: 1 })
})
