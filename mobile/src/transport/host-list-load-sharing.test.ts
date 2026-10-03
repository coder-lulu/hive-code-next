import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropSharedHostListLoad, shareHostListLoad } from './host-list-load-sharing'
import type { HostListSnapshot } from './host-list-load-sharing'

function deferred() {
  let resolve: (hosts: HostListSnapshot) => void = () => {}
  const promise = new Promise<HostListSnapshot>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('shareHostListLoad', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    dropSharedHostListLoad()
  })

  it('reuses a completed read for 30 seconds and invalidates it on writes', async () => {
    vi.useFakeTimers()
    const load = vi.fn(async () => ({ catalog: [], profiles: [] }))
    const first = await shareHostListLoad(load)
    vi.advanceTimersByTime(29_999)
    expect(await shareHostListLoad(load)).toBe(first)
    expect(load).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1)
    await shareHostListLoad(load)
    expect(load).toHaveBeenCalledTimes(2)
    dropSharedHostListLoad()
    await shareHostListLoad(load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('retries failed reads without caching the failure', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValue({ catalog: [], profiles: [] })
    await expect(shareHostListLoad(load)).rejects.toThrow('locked')
    await shareHostListLoad(load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries temporarily unavailable credentials instead of caching a partial catalog', async () => {
    const snapshot: HostListSnapshot = {
      profiles: [],
      catalog: [
        {
          id: 'host',
          name: 'Host',
          endpoint: 'ws://host',
          publicKeyB64: 'key',
          lastConnected: 0,
          credentialStatus: 'temporarily-unavailable',
          profile: null
        }
      ]
    }
    const load = vi.fn(async () => snapshot)
    await shareHostListLoad(load)
    await shareHostListLoad(load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('runs one pass for callers that arrive while it is still open', async () => {
    const pass = deferred()
    const load = vi.fn(() => pass.promise)

    const first = shareHostListLoad(load)
    const second = shareHostListLoad(load)
    pass.resolve({ catalog: [], profiles: [] })

    expect(load).toHaveBeenCalledTimes(1)
    expect(await first).toBe(await second)
  })

  it('starts a fresh pass for callers that arrive after a write dropped it', async () => {
    const stale = deferred()
    const fresh = deferred()
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)

    const before = shareHostListLoad(load)
    dropSharedHostListLoad()
    const after = shareHostListLoad(load)

    stale.resolve({ catalog: [], profiles: [] })
    fresh.resolve({ catalog: [], profiles: [] })
    expect(load).toHaveBeenCalledTimes(2)
    expect(await after).not.toBe(await before)
  })

  it('keeps the replacement pass on offer when the dropped one settles late', async () => {
    const stale = deferred()
    const fresh = deferred()
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)

    const before = shareHostListLoad(load)
    dropSharedHostListLoad()
    const replacement = shareHostListLoad(load)
    // The dropped pass settles after its replacement was registered.
    stale.resolve({ catalog: [], profiles: [] })
    await before

    expect(shareHostListLoad(load)).toBe(replacement)
    expect(load).toHaveBeenCalledTimes(2)
    const snapshot = { catalog: [], profiles: [] }
    fresh.resolve(snapshot)
    await replacement
    expect(await shareHostListLoad(load)).toBe(snapshot)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
