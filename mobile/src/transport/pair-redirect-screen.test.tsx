vi.mock('../theme/mobile-theme-provider', async () => {
  const { createLightThemeTestModule } = await import('../theme/mobile-theme.test-fixture')
  return createLightThemeTestModule()
})
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  params: {} as { code?: string | string[] },
  router: { replace: vi.fn() },
  initialUrl: vi.fn<() => Promise<string | null>>()
}))
vi.mock('expo-router', () => ({
  useRouter: () => state.router,
  useLocalSearchParams: () => state.params
}))
vi.mock('react-native', () => ({
  Linking: { getInitialURL: state.initialUrl },
  View: 'View',
  ScrollView: 'ScrollView',
  StyleSheet: { create: (styles: unknown) => styles }
}))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }))
vi.mock('lucide-react-native', () => ({
  AlertTriangle: 'AlertTriangle',
  ChevronLeft: 'ChevronLeft'
}))
vi.mock('../components/pairing/PairingActionButton', () => ({
  PairingActionButton: 'PairingActionButton'
}))
vi.mock('../components/pairing/PairingScreenContent', () => ({
  PairingConnectingState: 'PairingConnectingState',
  PairingScreenContent: 'PairingScreenContent'
}))
vi.mock('../components/ui/MobileIconButton', () => ({ MobileIconButton: 'MobileIconButton' }))
vi.mock('../components/ui/MobileScreenHeader', () => ({ MobileScreenHeader: 'MobileScreenHeader' }))
import PairRedirectScreen from '../../app/pair'
import { PairingScreenContent } from '../components/pairing/PairingScreenContent'
import { hivecodeProductConfig } from '../generated/product-config'

let tree: ReactTestRenderer | undefined
const mount = async () => {
  await act(async () => {
    tree = create(createElement(PairRedirectScreen))
  })
}
function deferredUrl() {
  let resolve!: (url: string | null) => void
  const promise = new Promise<string | null>((done) => {
    resolve = done
  })
  state.initialUrl.mockReturnValue(promise)
  return resolve
}
const url = (code: string) => `${hivecodeProductConfig.schemes.primary}://pair?code=${code}`
beforeEach(() => {
  state.params = {}
  vi.clearAllMocks()
  state.initialUrl.mockResolvedValue(null)
})
afterEach(async () => {
  await act(async () => tree?.unmount())
  tree = undefined
})

describe('actual pairing redirect page lifecycle', () => {
  it.each(['current-code', ['current-code', 'ignored-code']])(
    'uses route credentials before initial URL: %j',
    async (code) => {
      state.params = { code }
      await mount()
      expect(state.router.replace).toHaveBeenCalledExactlyOnceWith({
        pathname: '/pair-confirm',
        params: { code: 'current-code' }
      })
      expect(state.initialUrl).not.toHaveBeenCalled()
    }
  )
  it('extracts a supported initial URL and redirects to confirmation', async () => {
    state.initialUrl.mockResolvedValue(url('url-code'))
    await mount()
    expect(state.router.replace).toHaveBeenCalledExactlyOnceWith({
      pathname: '/pair-confirm',
      params: { code: 'url-code' }
    })
  })
  it.each(['https://example.com/pair?code=foreign', null])(
    'shows unavailable credentials without navigating: %j',
    async (initialUrl) => {
      state.initialUrl.mockResolvedValue(initialUrl)
      await mount()
      expect(state.router.replace).not.toHaveBeenCalled()
      expect(tree!.root.findByType(PairingScreenContent).props.title).toBe('配对链接无效')
    }
  )
  it('handles rejected URL lookup without an unhandled rejection', async () => {
    state.initialUrl.mockRejectedValue(new Error('unavailable'))
    await mount()
    expect(state.router.replace).not.toHaveBeenCalled()
    expect(tree!.root.findByType(PairingScreenContent).props.title).toBe('配对链接无效')
  })
  it('does not navigate after unmount while the URL lookup is pending', async () => {
    const resolve = deferredUrl()
    await mount()
    await act(async () => tree!.unmount())
    tree = undefined
    await act(async () => resolve(url('stale-code')))
    expect(state.router.replace).not.toHaveBeenCalled()
  })
  it('does not let an earlier URL lookup replace newer route credentials', async () => {
    const resolve = deferredUrl()
    await mount()
    state.params = { code: 'new-code' }
    await act(async () => tree!.update(createElement(PairRedirectScreen)))
    await act(async () => resolve(url('stale-code')))
    expect(state.router.replace).toHaveBeenCalledExactlyOnceWith({
      pathname: '/pair-confirm',
      params: { code: 'new-code' }
    })
  })
})
