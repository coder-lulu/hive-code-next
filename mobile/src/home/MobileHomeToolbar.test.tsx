import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../product-brand'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeToolbar } from './MobileHomeToolbar'

const viewport = vi.hoisted(() => ({ width: 390 }))
vi.mock('../components/OrcaLogo', () => ({ OrcaLogo: 'Logo' }))

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: {
    create: <T,>(styles: T) => styles,
    hairlineWidth: 1
  },
  Text: 'Text',
  useWindowDimensions: () => ({ width: viewport.width, height: 844 }),
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  ArrowLeft: 'ArrowLeft',
  RefreshCw: 'RefreshCw',
  Menu: 'Menu'
}))

function renderToolbar(): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(MobileHomeToolbar, {
        onOpenMenu: vi.fn(),
        theme: lightTheme
      })
    )
  })
  return renderer!
}

describe('MobileHomeToolbar', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    viewport.width = 390
  })
  it('offers one busy-aware refresh action on the devices screen', () => {
    const refresh = vi.fn()
    const props = {
      theme: lightTheme,
      onOpenMenu: vi.fn(),
      onRefresh: refresh
    }
    act(() => {
      renderer = create(createElement(MobileHomeToolbar, props))
    })
    act(() => renderer!.root.findByProps({ accessibilityLabel: '刷新设备' }).props.onPress())
    expect(refresh).toHaveBeenCalledOnce()
    act(() => renderer!.update(createElement(MobileHomeToolbar, { ...props, refreshing: true })))
    expect(renderer!.root.findByProps({ accessibilityLabel: '刷新设备' }).props.disabled).toBe(true)
    expect(renderer!.root.findByProps({ children: '刷新中' })).toBeTruthy()
  })

  it('keeps the brand on one line in the 320dp compact layout', () => {
    viewport.width = 320
    renderer = renderToolbar()

    const brand = renderer.root.findByProps({ accessibilityLabel: APP_DISPLAY_NAME })
    expect(brand.props.accessibilityRole).toBe('header')
    expect(renderer.root.findAllByProps({ children: APP_DISPLAY_NAME })).toHaveLength(0)
    expect(renderer.root.findByType('Logo' as never).props.size).toBe(24)
  })

  it('keeps the page-title type scale outside the compact breakpoint', () => {
    renderer = renderToolbar()

    const brand = renderer.root.findByProps({ children: APP_DISPLAY_NAME })
    expect(brand.props.style.fontSize).toBe(lightTheme.typography.pageTitle.fontSize)
    expect(brand.parent?.props.style.width).toBe(
      lightTheme.spacing.space64 * 2 + lightTheme.spacing.space8
    )
  })

  it('keeps the drawer menu control working', () => {
    renderer = renderToolbar()
    const menu = renderer.root.findByProps({ accessibilityLabel: '打开导航菜单' })
    act(() => {
      menu.props.onPress()
    })
    expect(menu.props.onPress).toHaveBeenCalledOnce()
  })

  it('uses a back button instead of the navigation menu on a secondary screen', () => {
    const back = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileHomeToolbar, {
          theme: lightTheme,
          onBack: back,
          onRefresh: vi.fn()
        })
      )
    })
    act(() => renderer!.root.findByProps({ accessibilityLabel: '返回' }).props.onPress())
    expect(back).toHaveBeenCalledOnce()
    expect(renderer!.root.findAllByProps({ accessibilityLabel: '打开导航菜单' })).toHaveLength(0)
    expect(renderer!.root.findAllByType('ArrowLeft')).toHaveLength(1)
  })
})
