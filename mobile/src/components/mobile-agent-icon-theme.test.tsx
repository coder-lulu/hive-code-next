import { findAllByHostType } from '../test-support/react-test-renderer-host-nodes'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileAgentIcon } from './MobileAgentIcon'
import { applyMobileColorScheme, paletteForScheme } from '../theme/mobile-theme'

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

describe('MobileAgentIcon theme colors', () => {
  afterEach(() => applyMobileColorScheme('light'))
  it.each(['light', 'dark'] as const)('keeps both Pi glyph paths readable on %s', (scheme) => {
    applyMobileColorScheme(scheme)
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId: 'pi' }))
    })
    const color = paletteForScheme(scheme).textPrimary
    expect(findAllByHostType(renderer!.root, 'Path').map((path) => path.props.fill)).toEqual([
      color,
      color
    ])
    act(() => renderer?.unmount())
  })

  it('uses graphite for the OpenAI icon on a light theme', () => {
    applyMobileColorScheme('light')
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId: 'codex' }))
    })

    expect(findAllByHostType(renderer!.root, 'Path')[0]?.props.fill).toBe(
      paletteForScheme('light').textPrimary
    )
  })

  it('keeps the OpenAI icon readable on a dark theme', () => {
    applyMobileColorScheme('dark')
    let renderer: ReactTestRenderer | null = null
    act(() => {
      renderer = create(createElement(MobileAgentIcon, { agentId: 'codex' }))
    })

    expect(findAllByHostType(renderer!.root, 'Path')[0]?.props.fill).toBe(
      paletteForScheme('dark').textPrimary
    )
  })
})
