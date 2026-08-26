import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'

const nativeState = vi.hoisted(() => ({ scheme: 'light' as 'light' | 'dark' | null }))

vi.mock('react-native', () => ({ useColorScheme: () => nativeState.scheme }))

import {
  MobileThemeProvider,
  resolveMobileThemeScheme,
  useMobileTheme,
  useMobileThemeStyles
} from './mobile-theme-provider'

function ThemeProbe() {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles((currentTheme) => ({ canvas: currentTheme.color.bg.canvas }))
  return createElement('ThemeProbe', { scheme: theme.scheme, canvas: styles.canvas })
}

describe('MobileThemeProvider', () => {
  let renderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    nativeState.scheme = 'light'
  })

  it('follows the system color scheme by default', () => {
    nativeState.scheme = 'dark'
    act(() => {
      renderer = create(createElement(MobileThemeProvider, null, createElement(ThemeProbe)))
    })

    expect(renderer!.root.findByType('ThemeProbe').props).toMatchObject({
      scheme: 'dark',
      canvas: '#0D0F12'
    })
  })

  it('allows deterministic preference and system-scheme injection', () => {
    act(() => {
      renderer = create(
        createElement(
          MobileThemeProvider,
          { preference: 'system', systemSchemeOverride: 'dark' },
          createElement(ThemeProbe)
        )
      )
    })
    expect(renderer!.root.findByType('ThemeProbe').props.scheme).toBe('dark')

    act(() => {
      renderer!.update(
        createElement(
          MobileThemeProvider,
          { preference: 'light', systemSchemeOverride: 'dark' },
          createElement(ThemeProbe)
        )
      )
    })
    expect(renderer!.root.findByType('ThemeProbe').props.scheme).toBe('light')
  })

  it('uses light as the safe fallback for an unavailable system scheme', () => {
    expect(resolveMobileThemeScheme('system', null)).toBe('light')
  })
})
