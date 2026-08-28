import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { MobileAgentIcon } from './MobileAgentIcon'
import { darkThemeColors, lightThemeColors } from '../theme/mobile-theme'

const themeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' }))

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({ Terminal: 'Terminal' }))

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Defs: 'Defs',
  G: 'G',
  LinearGradient: 'LinearGradient',
  Path: 'Path',
  Stop: 'Stop'
}))

vi.mock('./mobile-agent-icon-assets', () => ({ MOBILE_AGENT_ICON_ASSETS: {} }))

vi.mock('../theme/mobile-theme-provider', () => ({
  useMobileTheme: () => ({
    color: {
      text: {
        primary: themeState.scheme === 'light' ? lightThemeColors.text.primary : darkThemeColors.text.primary
      }
    }
  })
}))

describe('MobileAgentIcon theme colors', () => {
  it('uses graphite for the OpenAI icon on a light theme', () => {
    themeState.scheme = 'light'
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId: 'codex' }))
    })

    expect(renderer?.root.findAllByType('Path')[0]?.props.fill).toBe(lightThemeColors.text.primary)
  })

  it('keeps the OpenAI icon readable on a dark theme', () => {
    themeState.scheme = 'dark'
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId: 'codex' }))
    })

    expect(renderer?.root.findAllByType('Path')[0]?.props.fill).toBe(darkThemeColors.text.primary)
  })
})
