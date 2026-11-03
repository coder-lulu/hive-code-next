import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHosts, resetHostStoreForTests, updateHostNameAndEndpoint } from './host-store'

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn()
  }
}))

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' }
}))

describe('updateHostNameAndEndpoint', () => {
  beforeEach(() => {
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockReset()
  })

  const stored = [
    {
      id: 'host-1',
      name: 'Desk',
      endpoint: 'ws://100.64.0.5:6768',
      publicKeyB64: 'pk',
      lastConnected: 1
    },
    {
      id: 'host-2',
      name: 'Laptop',
      endpoint: 'wss://laptop.example:8443',
      publicKeyB64: 'pk-2',
      lastConnected: 2
    }
  ]

  // Legacy typed names parse as phone overrides, so the untouched row keeps its override too.
  const legacyOverride = (host: (typeof stored)[number]) => ({ ...host, personalName: host.name })

  function writtenHosts(): unknown {
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1)
    const [key, value] = vi.mocked(AsyncStorage.setItem).mock.calls[0]!
    expect(key).toBe('orca:hosts')
    return JSON.parse(value)
  }

  it('commits the phone name and endpoint together in a single write', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', {
      personalName: 'Home Desk',
      endpoint: 'ws://192.168.1.10:6768'
    })

    expect(writtenHosts()).toEqual([
      {
        ...stored[0],
        name: 'Home Desk',
        personalName: 'Home Desk',
        endpoint: 'ws://192.168.1.10:6768'
      },
      legacyOverride(stored[1]!)
    ])
  })

  it('updates only the provided field', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { personalName: 'Home Desk' })

    expect(writtenHosts()).toEqual([
      { ...stored[0], name: 'Home Desk', personalName: 'Home Desk' },
      legacyOverride(stored[1]!)
    ])
  })

  it('rewrites only the endpoint when the name is omitted', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue(JSON.stringify(stored))

    await updateHostNameAndEndpoint('host-1', { endpoint: 'ws://192.168.1.10:6768' })

    expect(writtenHosts()).toEqual([
      { ...legacyOverride(stored[0]!), endpoint: 'ws://192.168.1.10:6768' },
      legacyOverride(stored[1]!)
    ])
  })

  it('throws and writes nothing when the host is missing', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValue('[]')

    await expect(updateHostNameAndEndpoint('missing', { personalName: 'Renamed' })).rejects.toThrow(
      'Host not found'
    )
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
  })
})

describe('direct endpoint authority after a host edit', () => {
  const OVERLAY_KEY = 'orca:mobile-relay:host-overlays:v2'
  const OLD_ENDPOINT = 'ws://192.168.1.10:6768'
  const NEW_ENDPOINT = 'ws://192.168.1.20:6768'
  const relay = {
    v: 1 as const,
    directorUrl: 'https://relay.onorca.dev',
    cellUrl: 'https://relay-c1.onorca.dev',
    assignmentEpoch: 7,
    relayHostId: 'AbCdEf0123_-xyZ9',
    e2eeFraming: 2 as const
  }
  const storage = new Map<string, string>()

  beforeEach(() => {
    resetHostStoreForTests()
    storage.clear()
    storage.set(
      'orca:hosts',
      JSON.stringify([
        { id: 'host-1', name: 'Desk', endpoint: OLD_ENDPOINT, publicKeyB64: 'pk', lastConnected: 1 }
      ])
    )
    // An older build's record: a copy of the row's address beside the relay.
    storage.set(
      OVERLAY_KEY,
      JSON.stringify([
        {
          v: 2,
          hostId: 'host-1',
          endpoints: [
            { id: 'direct-primary', kind: 'lan', url: OLD_ENDPOINT },
            { id: 'relay-primary', kind: 'relay', url: 'wss://relay-c1.onorca.dev/v1/connect/id' }
          ],
          relayHostId: relay.relayHostId
        }
      ])
    )
    vi.mocked(AsyncStorage.getItem).mockReset()
    vi.mocked(AsyncStorage.getItem).mockImplementation(async (key) => storage.get(key) ?? null)
    vi.mocked(AsyncStorage.setItem).mockReset()
    vi.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
      storage.set(key, value)
    })
    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('device-token')
    vi.mocked(SecureStore.setItemAsync).mockReset()
  })

  it('loads only the edited address, whatever an older overlay stored', async () => {
    await updateHostNameAndEndpoint('host-1', { endpoint: NEW_ENDPOINT })

    const [host] = await loadHosts()
    expect(host).toEqual({
      id: 'host-1',
      name: 'Desk',
      personalName: 'Desk',
      endpoint: NEW_ENDPOINT,
      publicKeyB64: 'pk',
      lastConnected: 1,
      deviceToken: 'device-token'
    })
  })

  it('retains edited direct identity and credentials across repeated catalog reloads', async () => {
    await updateHostNameAndEndpoint('host-1', { personalName: 'Renamed', endpoint: NEW_ENDPOINT })
    const committed = storage.get('orca:hosts')
    vi.mocked(AsyncStorage.setItem).mockClear()
    for (let index = 0; index < 2; index++) {
      const [host] = await loadHosts()
      expect(host).toMatchObject({
        id: 'host-1',
        name: 'Renamed',
        endpoint: NEW_ENDPOINT,
        deviceToken: 'device-token'
      })
      expect(host).not.toHaveProperty('relay')
    }
    expect(storage.get('orca:hosts')).toBe(committed)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled()
  })
  it('refuses to resurrect a removed host through a late edit', async () => {
    storage.set('orca:hosts', '[]')
    await expect(updateHostNameAndEndpoint('host-1', { endpoint: NEW_ENDPOINT })).rejects.toThrow(
      'Host not found'
    )
    expect(AsyncStorage.setItem).not.toHaveBeenCalled()
    await expect(loadHosts()).resolves.toEqual([])
  })
})
