import AsyncStorage from '@react-native-async-storage/async-storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() }
}))

const stored = new Map<string, string>()
import { AUTHENTICATED_DIRECT_FRAMING_POLICY } from './authenticated-direct-framing-policy'
import {
  hydrateE2EEV2HostLatch,
  isHostLatchedToE2EEV2,
  latchHostToE2EEV2,
  resetE2EEV2HostLatchForTests
} from './e2ee-v2-host-latch'

describe('E2EE v2 host latch', () => {
  beforeEach(() => {
    resetE2EEV2HostLatchForTests()
    stored.clear()
    vi.mocked(AsyncStorage.getItem)
      .mockReset()
      .mockImplementation(async (key) => stored.get(key) ?? null)
    vi.mocked(AsyncStorage.setItem)
      .mockReset()
      .mockImplementation(async (key, value) => {
        stored.set(key, value)
      })
  })

  it('requires authenticated v2 even when hydrated storage has never seen the host', async () => {
    let release!: (value: string | null) => void
    vi.mocked(AsyncStorage.getItem).mockReturnValue(new Promise((resolve) => (release = resolve)))
    const policy = AUTHENTICATED_DIRECT_FRAMING_POLICY
    policy.noteV2HelloRefused()
    expect(isHostLatchedToE2EEV2('host-key')).toBeNull()
    expect(policy.framingForNextDial()).toBe('v2')

    release(null)
    await hydrateE2EEV2HostLatch()
    expect(policy.framingForNextDial()).toBe('v2')
    expect(policy.mayUseLegacy()).toBe(false)
  })

  it('keeps a latch recorded before hydration and persists it', async () => {
    let finishWrite!: () => void
    const written = new Promise<void>((resolve) => {
      finishWrite = resolve
    })
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      stored.set(key, value)
      finishWrite()
    })
    latchHostToE2EEV2('host-key')
    expect(isHostLatchedToE2EEV2('host-key')).toBe(true)
    await hydrateE2EEV2HostLatch()
    await written
    expect(stored.get('orca:e2ee-v2-hosts')).toBe('["host-key"]')
    resetE2EEV2HostLatchForTests()
    expect(isHostLatchedToE2EEV2('host-key')).toBeNull()
    await hydrateE2EEV2HostLatch()
    expect(isHostLatchedToE2EEV2('host-key')).toBe(true)
    expect(isHostLatchedToE2EEV2('other-host')).toBe(false)
  })

  it('keeps unreadable storage unknown (no fallback) and retries the read', async () => {
    vi.mocked(AsyncStorage.getItem)
      .mockRejectedValueOnce(new Error('transient read failure'))
      .mockResolvedValueOnce(JSON.stringify(['host-key']))
    const policy = AUTHENTICATED_DIRECT_FRAMING_POLICY
    await hydrateE2EEV2HostLatch()
    expect(isHostLatchedToE2EEV2('host-key')).toBeNull()
    policy.noteV2HelloRefused()
    expect(policy.framingForNextDial()).toBe('v2')
    expect(policy.helloRefusalIsAuthFailure()).toBe(true)

    await hydrateE2EEV2HostLatch()
    expect(isHostLatchedToE2EEV2('host-key')).toBe(true)
    expect(policy.framingForNextDial()).toBe('v2')
    expect(policy.helloRefusalIsAuthFailure()).toBe(true)
  })

  it('ignores malformed persisted entries', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify(['a', 7, '', null]))
    await hydrateE2EEV2HostLatch()
    expect(isHostLatchedToE2EEV2('a')).toBe(true)
    expect(isHostLatchedToE2EEV2('')).toBe(false)
    expect(isHostLatchedToE2EEV2('7')).toBe(false)
    expect(isHostLatchedToE2EEV2('null')).toBe(false)
    latchHostToE2EEV2('b')
    await Promise.resolve()
    expect(stored.get('orca:e2ee-v2-hosts')).toBe('["a","b"]')
  })

  it('cannot downgrade after a refused authenticated direct hello', async () => {
    await hydrateE2EEV2HostLatch()
    const policy = AUTHENTICATED_DIRECT_FRAMING_POLICY
    policy.noteV2Authenticated()
    policy.noteV2HelloRefused()
    expect(policy.framingForNextDial()).toBe('v2')
    expect(policy.mayUseLegacy()).toBe(false)
    expect(policy.helloRefusalIsAuthFailure()).toBe(true)
  })
})
