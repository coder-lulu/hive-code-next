import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import { HostScreenView } from './host-screen-view'
import type { HostScreenController } from './use-host-screen-controller'

vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }))
vi.mock('lucide-react-native', () => ({ MonitorOff: 'MonitorOff' }))
vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => lightTheme,
  useMobileThemeStyles: <T,>(factory: (theme: typeof lightTheme) => T) => factory(lightTheme)
}))
vi.mock('../components/MobilePrimaryNavigation', () => ({
  MobilePrimaryNavigation: 'MobilePrimaryNavigation'
}))
vi.mock('./host-screen-header', () => ({ HostScreenHeader: 'HostScreenHeader' }))
vi.mock('./host-screen-overlays', () => ({ HostScreenOverlays: 'HostScreenOverlays' }))
vi.mock('./host-workspace-list', () => ({ HostWorkspaceList: 'HostWorkspaceList' }))

function controller(error: string, setShowRuntimeSelector = vi.fn()): HostScreenController {
  return {
    actions: { leaveHost: vi.fn(), navigateFromHostList: vi.fn() },
    embedded: false,
    hostId: 'stale-runtime',
    insets: { bottom: 0 },
    state: { error, setShowRuntimeSelector }
  } as unknown as HostScreenController
}

describe('HostScreenView', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
  })

  it('keeps the phone shell and offers runtime recovery for an invalid route', () => {
    const setShowRuntimeSelector = vi.fn()
    act(() => {
      renderer = create(
        createElement(HostScreenView, {
          controller: controller('Host not found', setShowRuntimeSelector)
        })
      )
    })

    expect(renderer.root.findAllByType('SafeAreaView')).toHaveLength(1)
    expect(renderer.root.findAllByType('HostScreenHeader')).toHaveLength(1)
    expect(renderer.root.findAllByType('HostScreenOverlays')).toHaveLength(1)
    expect(renderer.root.findAllByType('MobilePrimaryNavigation')).toHaveLength(1)
    expect(renderer.root.findAllByType('HostWorkspaceList')).toHaveLength(0)

    const text = renderer.root
      .findAllByType('Text')
      .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
    expect(text).toContain('Runtime 不可用')
    expect(text).not.toContain('Host not found')

    act(() => renderer.root.findByType('Pressable').props.onPress())
    expect(setShowRuntimeSelector).toHaveBeenCalledWith(true)
  })

  it('renders the workspace list when the selected runtime is valid', () => {
    act(() => {
      renderer = create(createElement(HostScreenView, { controller: controller('') }))
    })

    expect(renderer.root.findAllByType('HostWorkspaceList')).toHaveLength(1)
  })
})
