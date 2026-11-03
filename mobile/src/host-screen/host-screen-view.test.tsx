import { findAllByHostType, findByHostType } from '../test-support/react-test-renderer-host-nodes'
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
vi.mock('./host-screen-header', () => ({ HostScreenHeader: 'HostScreenHeader' }))
vi.mock('./host-screen-overlays', () => ({ HostScreenOverlays: 'HostScreenOverlays' }))
vi.mock('./host-workspace-list', () => ({ HostWorkspaceList: 'HostWorkspaceList' }))

function controller(error: string, setShowRuntimeSelector = vi.fn()): HostScreenController {
  return {
    actions: { leaveHost: vi.fn(), navigateFromHostList: vi.fn() },
    router: { dismissTo: vi.fn() },
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

    expect(findAllByHostType(renderer!.root, 'SafeAreaView')).toHaveLength(1)
    expect(findAllByHostType(renderer!.root, 'HostScreenHeader')).toHaveLength(1)
    expect(findAllByHostType(renderer!.root, 'HostScreenOverlays')).toHaveLength(1)
    expect(findAllByHostType(renderer!.root, 'MobilePrimaryNavigation')).toHaveLength(0)
    expect(findAllByHostType(renderer!.root, 'HostWorkspaceList')).toHaveLength(0)

    const text = findAllByHostType(renderer!.root, 'Text').flatMap((node) =>
      node.children.filter((child) => typeof child === 'string')
    )
    expect(text).toContain('Runtime 不可用')
    expect(text).not.toContain('Host not found')

    act(() => findByHostType(renderer!.root, 'Pressable').props.onPress())
    expect(setShowRuntimeSelector).toHaveBeenCalledWith(true)
  })

  it('renders the workspace list when the selected runtime is valid', () => {
    act(() => {
      renderer = create(createElement(HostScreenView, { controller: controller('') }))
    })

    expect(findAllByHostType(renderer!.root, 'HostWorkspaceList')).toHaveLength(1)
  })

  it('protects the phone bottom safe area without adding primary tabs', () => {
    const currentController = controller('')
    act(() => {
      renderer = create(createElement(HostScreenView, { controller: currentController }))
    })

    expect(findByHostType(renderer!.root, 'SafeAreaView').props.edges).toEqual(['top', 'bottom'])
    expect(findAllByHostType(renderer!.root, 'MobilePrimaryNavigation')).toHaveLength(0)
  })

  it('leaves the embedded host bottom inset to its parent', () => {
    const currentController = controller('')
    currentController.embedded = true
    act(() => {
      renderer = create(createElement(HostScreenView, { controller: currentController }))
    })
    expect(findByHostType(renderer!.root, 'SafeAreaView').props.edges).toEqual(['top'])
  })
})
