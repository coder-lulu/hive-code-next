import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EditHostScreen from '../app/h/[hostId]/edit'

const dependencies = vi.hoisted(() => ({
  back: vi.fn(),
  forceReconnectHost: vi.fn(),
  directoryScope: { authorityId: 'hive-primary', accountId: 'account-a' },
  directoryEntries: [] as unknown[],
  pendingDisplayNames: new Map<string, string | null>(),
  queueDisplayNameUpdate: vi.fn(),
  hostId: 'host-1',
  loadHosts: vi.fn(),
  primeHosts: vi.fn(),
  updateHostNameAndEndpoint: vi.fn()
}))

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 })
}))

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ hostId: dependencies.hostId }),
  useRouter: () => ({ back: dependencies.back })
}))

vi.mock('lucide-react-native', () => ({
  ChevronLeft: 'ChevronLeft'
}))

vi.mock('./theme/mobile-theme-provider', async () => {
  const { lightTheme } = await import('./theme/mobile-theme')
  return {
    useMobileTheme: () => lightTheme,
    useMobileThemeStyles: (factory: (theme: typeof lightTheme) => unknown) => factory(lightTheme)
  }
})

vi.mock('./transport/host-store', () => ({
  loadHosts: dependencies.loadHosts,
  updateHostNameAndEndpoint: dependencies.updateHostNameAndEndpoint
}))

vi.mock('./transport/client-context', () => ({
  useForceReconnect: () => dependencies.forceReconnectHost,
  usePrimeHosts: () => dependencies.primeHosts
}))

vi.mock('./runtime-directory/account-runtime-directory-provider', () => ({
  useAccountRuntimeDirectory: () => ({
    state: {
      status: 'ready',
      scope: dependencies.directoryScope,
      entries: dependencies.directoryEntries
    },
    pendingDisplayNames: dependencies.pendingDisplayNames,
    queueDisplayNameUpdate: dependencies.queueDisplayNameUpdate
  })
}))

const CLOUD_RUNTIME = {
  runtimeRecordId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cloudDisplayName: 'Cloud Desk',
  cloudDisplayNameVersion: 3,
  deviceName: 'Reported Desk',
  resourceVersion: 7
}

async function renderEditHostRoute(): Promise<ReactTestRenderer> {
  let renderer: ReactTestRenderer | null = null
  await act(async () => {
    renderer = create(createElement(EditHostScreen))
    await Promise.resolve()
  })
  if (!renderer) {
    throw new Error('Edit host route did not render')
  }
  return renderer
}

describe('edit host route accessibility', () => {
  beforeEach(() => {
    dependencies.hostId = 'host-1'
    dependencies.directoryEntries = []
    dependencies.pendingDisplayNames = new Map()
    dependencies.loadHosts.mockReset().mockResolvedValue([
      {
        id: 'host-1',
        name: 'Desk',
        endpoint: 'ws://192.168.1.10:6768',
        deviceToken: 'token',
        publicKeyB64: 'public-key',
        lastConnected: 1
      }
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes stable accessible names for both editable fields', async () => {
    const renderer = await renderEditHostRoute()

    const inputs = renderer.root.findAllByType('TextInput')
    expect(inputs).toHaveLength(2)
    expect(inputs.map((input) => input.props.accessibilityLabel)).toEqual(['Name', 'Address'])

    act(() => renderer.unmount())
  })

  it('keeps a claimed local host editable after binding its account Runtime', async () => {
    dependencies.directoryEntries = [CLOUD_RUNTIME]
    dependencies.loadHosts.mockResolvedValueOnce([
      {
        id: 'host-1',
        name: 'Desk',
        endpoint: 'ws://192.168.1.10:6768',
        deviceToken: 'token',
        publicKeyB64: 'public-key',
        lastConnected: 1,
        runtimeRecordId: CLOUD_RUNTIME.runtimeRecordId
      }
    ])
    const renderer = await renderEditHostRoute()

    expect(renderer.root.findAllByType('TextInput')).toHaveLength(2)

    act(() => renderer.unmount())
  })

  it('makes an account-only Runtime name editable without creating an address field', async () => {
    dependencies.hostId = CLOUD_RUNTIME.runtimeRecordId
    dependencies.directoryEntries = [CLOUD_RUNTIME]
    dependencies.loadHosts.mockResolvedValueOnce([])
    const renderer = await renderEditHostRoute()
    const inputs = renderer.root.findAllByType('TextInput')

    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.props.accessibilityLabel).toBe('Name')

    act(() => renderer.unmount())
  })
})
