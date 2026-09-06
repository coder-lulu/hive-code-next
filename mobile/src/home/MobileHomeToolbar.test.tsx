import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_DISPLAY_NAME } from '../product-brand'
import { lightTheme } from '../theme/mobile-theme'
import { MobileHomeToolbar } from './MobileHomeToolbar'

const viewport = vi.hoisted(() => ({ width: 390 }))

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
  ChevronDown: 'ChevronDown',
  Menu: 'Menu'
}))

function renderToolbar(runtimeName: string | null = null): ReactTestRenderer {
  let renderer: ReactTestRenderer
  act(() => {
    renderer = create(
      createElement(MobileHomeToolbar, {
        onOpenMenu: vi.fn(),
        onOpenRuntimeSelector: vi.fn(),
        runtimeName,
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

  it('keeps the brand and Runtime selector on one line in the 320dp compact layout', () => {
    viewport.width = 320
    renderer = renderToolbar()

    const brand = renderer.root.findByProps({ children: APP_DISPLAY_NAME })
    expect(brand.props.numberOfLines).toBe(1)
    expect(brand.props.style.fontSize).toBe(lightTheme.typography.body.fontSize)
    expect(renderer.root.findByProps({ children: '连接电脑' })).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: '云端工作' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ children: '不可验证' })).toHaveLength(0)
  })

  it('keeps the page-title type scale outside the compact breakpoint', () => {
    renderer = renderToolbar()

    const brand = renderer.root.findByProps({ children: APP_DISPLAY_NAME })
    expect(brand.props.style.fontSize).toBe(lightTheme.typography.pageTitle.fontSize)
    expect(brand.parent?.props.style.width).toBe(
      lightTheme.spacing.space64 + lightTheme.spacing.space48
    )
  })

  it('shows the selected Runtime and keeps its full name accessible on narrow screens', () => {
    viewport.width = 320
    const runtimeName = 'DESKTOP-UL1DAG2 development computer'
    renderer = renderToolbar(runtimeName)

    const name = renderer.root.findByProps({ children: runtimeName })
    expect(name.props.numberOfLines).toBe(1)
    expect(name.props.style.flexShrink).toBe(1)
    expect(name.props.maxFontSizeMultiplier).toBe(1.3)
    expect(
      renderer.root.findByProps({ accessibilityLabel: `选择 Runtime，当前为 ${runtimeName}` })
    ).toBeTruthy()
    expect(renderer.root.findAllByProps({ children: '连接电脑' })).toHaveLength(0)
  })
})
