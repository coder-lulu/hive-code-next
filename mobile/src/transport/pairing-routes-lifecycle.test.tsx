import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PreProfilePairingAttempt } from './pre-profile-pairing-coordinator'

const mocks = vi.hoisted(() => ({
  router: { back: vi.fn(), replace: vi.fn() },
  recover: vi.fn(),
  startPairing: vi.fn(),
  loadOnboarding: vi.fn(),
  onboardingDestination: vi.fn(() => '/onboarding'),
  refreshHostClient: vi.fn()
}))

const offer = {
  v: 1 as const,
  endpoint: 'ws://runtime.test',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key'
}

const theme = {
  color: {
    bg: { canvas: 'canvas', surface: 'surface', subtle: 'subtle', selected: 'selected' },
    border: { default: 'border' },
    brand: { primary: 'brand' },
    text: { primary: 'primary', secondary: 'secondary', inverse: 'inverse' }
  },
  radii: { small: 4, control: 8, card: 12 },
  spacing: {
    space4: 4,
    space8: 8,
    space12: 12,
    space16: 16,
    space20: 20,
    space24: 24
  },
  typography: { label: {}, meta: {}, pageTitle: {}, sectionTitle: {} }
}

vi.mock('@/product-brand', () => ({ productNameText: (value: string) => value }))
vi.mock('expo-router', () => ({
  useFocusEffect: vi.fn(),
  useLocalSearchParams: () => ({ code: 'pairing-code' }),
  useRouter: () => mocks.router
}))
vi.mock('expo-camera', () => ({
  CameraView: 'CameraView',
  useCameraPermissions: () => [{ canAskAgain: true, granted: true }, vi.fn()]
}))
vi.mock('lucide-react-native', () => ({
  AlertTriangle: 'AlertTriangle',
  ChevronLeft: 'ChevronLeft',
  ClipboardPaste: 'ClipboardPaste',
  Monitor: 'Monitor',
  QrCode: 'QrCode',
  RefreshCw: 'RefreshCw',
  Settings: 'Settings',
  ShieldCheck: 'ShieldCheck'
}))
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  BackHandler: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Linking: { openSettings: vi.fn() },
  ScrollView: 'ScrollView',
  StyleSheet: {
    absoluteFillObject: { position: 'absolute' },
    create: <T,>(styles: T) => styles
  },
  Text: 'Text',
  View: 'View',
  useWindowDimensions: () => ({ width: 390 })
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 })
}))
vi.mock('../components/ConnectionLog', () => ({ ConnectionLog: 'ConnectionLog' }))
vi.mock('../components/pairing/PairingActionButton', () => ({
  PairingActionButton: 'PairingActionButton'
}))
vi.mock('../components/pairing/PairingCodeSheet', () => ({
  PairingCodeSheet: 'PairingCodeSheet'
}))
vi.mock('../components/pairing/pairing-endpoint-label', () => ({
  pairingEndpointLabel: () => 'runtime.test'
}))
vi.mock('../components/pairing/pair-scan-camera-size', () => ({
  resolvePairScanCameraSize: () => 240
}))
vi.mock('../components/pairing/PairingScreenContent', () => ({
  PairingConnectingState: 'PairingConnectingState',
  PairingScreenContent: 'PairingScreenContent',
  PairingSecurityNotice: 'PairingSecurityNotice'
}))
vi.mock('../components/ui/MobileIconButton', () => ({
  MobileIconButton: 'MobileIconButton'
}))
vi.mock('../components/ui/MobileScreenHeader', () => ({
  MobileScreenHeader: ({ leading, title }: { leading: unknown; title: string }) =>
    createElement('MobileScreenHeader', { title }, leading)
}))
vi.mock('../onboarding/mobile-onboarding-plan', () => ({
  loadMobileOnboardingSteps: () => mocks.loadOnboarding(),
  mobileOnboardingDestination: (...args: unknown[]) => mocks.onboardingDestination(...args)
}))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => theme,
  useMobileThemeStyles: <T,>(factory: (value: typeof theme) => T) => factory(theme)
}))
vi.mock('./client-context', () => ({
  useRefreshHostClient: () => mocks.refreshHostClient
}))
vi.mock('./pair-confirm-state', () => ({
  resolvePairConfirmRouteState: () => ({ kind: 'ready', offer })
}))
vi.mock('./pairing', () => ({
  decodePairingUrl: () => offer,
  parsePairingCode: () => offer
}))
vi.mock('./pre-profile-pairing-coordinator', () => ({
  startPreProfilePairing: (...args: unknown[]) => mocks.startPairing(...args)
}))
vi.mock('./mobile-relay-pairing-recovery', () => ({
  recoverMobileRelayPairing: () => mocks.recover()
}))

import PairConfirmScreen from '../../app/pair-confirm'
import PairScanScreen from '../../app/pair-scan'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function successfulAttempt(hostId = 'host-1'): PreProfilePairingAttempt {
  return {
    result: Promise.resolve({ hostId }),
    timedOut: false,
    dispose: vi.fn()
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function render(component: React.ReactElement): ReactTestRenderer {
  return create(component, {
    createNodeMock: (element) => (element.type === 'View' ? {} : null)
  })
}

describe('pairing route async lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recover.mockResolvedValue('none')
    mocks.startPairing.mockImplementation(() => successfulAttempt())
    mocks.loadOnboarding.mockResolvedValue([])
  })

  it.each([
    ['confirmation', () => createElement(PairConfirmScreen), '确认并连接'],
    ['scanner', () => createElement(PairScanScreen), 'CameraView']
  ])('surfaces pairing recovery failures on the %s route', async (_name, screen, trigger) => {
    mocks.recover.mockRejectedValue(new Error('secure storage unavailable'))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = render(screen())
    })

    await act(async () => {
      if (trigger === 'CameraView') {
        renderer.root.findByType('CameraView').props.onBarcodeScanned({ data: 'code' })
      } else {
        renderer.root
          .findAllByType('PairingActionButton')
          .find((button) => button.props.label === trigger)!
          .props.onPress()
      }
      await flushPromises()
    })

    expect(mocks.startPairing).not.toHaveBeenCalled()
    expect(renderer.root.findByType('PairingScreenContent').props.description).toContain(
      'secure storage unavailable'
    )
  })

  it.each([
    ['confirmation', () => createElement(PairConfirmScreen), '确认并连接'],
    ['scanner', () => createElement(PairScanScreen), 'CameraView']
  ])('does not reopen onboarding after leaving the %s route', async (_name, screen, trigger) => {
    const onboarding = deferred<never[]>()
    mocks.loadOnboarding.mockReturnValue(onboarding.promise)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = render(screen())
    })

    await act(async () => {
      if (trigger === 'CameraView') {
        renderer.root.findByType('CameraView').props.onBarcodeScanned({ data: 'code' })
      } else {
        renderer.root
          .findAllByType('PairingActionButton')
          .find((button) => button.props.label === trigger)!
          .props.onPress()
      }
      await flushPromises()
    })
    expect(mocks.loadOnboarding).toHaveBeenCalledOnce()

    act(() => renderer.root.findByType('MobileIconButton').props.onPress())
    await act(async () => {
      onboarding.resolve([])
      await onboarding.promise
      await flushPromises()
    })

    expect(mocks.onboardingDestination).not.toHaveBeenCalled()
  })
})
