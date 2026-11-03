import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { darkTheme, type MobileTheme } from '../theme/mobile-theme'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'

const animationMocks = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))

vi.mock('react-native', () => ({
  Animated: {
    Value: class {},
    View: 'AnimatedView',
    delay: vi.fn(() => ({})),
    loop: vi.fn(() => animationMocks),
    sequence: vi.fn(() => ({})),
    timing: vi.fn(() => ({}))
  },
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileThemeStyles: (factory: (theme: MobileTheme) => unknown) => factory(darkTheme)
}))

function flattenStyle(style: unknown): Record<string, unknown> {
  const entries = Array.isArray(style) ? style.flat(Infinity).filter(Boolean) : [style]
  return Object.assign({}, ...entries)
}

describe('MobileAgentWorkingIndicator', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    animationMocks.start.mockClear()
    animationMocks.stop.mockClear()
  })

  it('announces Chinese working state and uses the dark AI semantic color', async () => {
    await act(async () => {
      renderer = create(createElement(MobileAgentWorkingIndicator))
    })
    const row = renderer!.root.findByProps({ accessibilityLiveRegion: 'polite' })
    const label = renderer!.root.findByType('Text')
    const dots = renderer!.root.findAllByType('AnimatedView')

    expect(row.props).toMatchObject({
      accessibilityLabel: 'Agent 正在工作',
      accessibilityRole: 'text'
    })
    expect(label.props).toMatchObject({ children: 'Agent 正在工作', maxFontSizeMultiplier: 1.3 })
    expect(flattenStyle(label.props.style).color).toBe(darkTheme.color.text.tertiary)
    expect(dots).toHaveLength(3)
    expect(flattenStyle(dots[0].props.style).backgroundColor).toBe(darkTheme.color.brand.primary)
    expect(animationMocks.start).toHaveBeenCalledTimes(3)
  })
})
