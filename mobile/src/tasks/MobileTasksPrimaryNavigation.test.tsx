import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { MobileTasksPrimaryNavigation } from './MobileTasksPrimaryNavigation'

const router = vi.hoisted(() => ({ dismissTo: vi.fn(), replace: vi.fn() }))
vi.mock('react-native', () => ({ Alert: { alert: vi.fn() } }))
vi.mock('expo-router', () => ({ useRouter: () => router }))
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 24 }) }))
vi.mock('../layout/responsive-layout', () => ({
  useResponsiveLayout: () => ({ isWideLayout: false })
}))
vi.mock('../theme/mobile-theme-provider', () => ({ useMobileTheme: () => lightTheme }))
vi.mock('../components/MobilePrimaryNavigation', () => ({ MobilePrimaryNavigation: 'Navigation' }))

let renderer: ReactTestRenderer | null = null
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = null
  vi.clearAllMocks()
})

it('leaves task history for the existing home instead of building a workspace/task loop', () => {
  act(() => {
    renderer = create(createElement(MobileTasksPrimaryNavigation, { hostId: 'runtime-a' }))
  })
  const navigation = renderer!.root.findByType('Navigation')
  act(() => navigation.props.onSelect('workspace'))
  expect(router.replace).toHaveBeenCalledWith('/h/runtime-a')
  act(() => navigation.props.onSelect('tasks'))
  expect(router.dismissTo).toHaveBeenCalledWith('/')
  expect(router.replace).toHaveBeenCalledTimes(1)
})
