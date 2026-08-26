import { describe, expect, it } from 'vitest'
import type { MobileTerminalTheme } from './terminal-webview-contract'
import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { resolveMobileTerminalTheme } from './mobile-terminal-theme'

const runtimeDarkTheme: MobileTerminalTheme = {
  mode: 'dark',
  theme: {
    background: '#000000',
    foreground: '#FFFFFF'
  }
}

const runtimeLightTheme: MobileTerminalTheme = {
  mode: 'light',
  theme: {
    background: '#FAFAFA',
    foreground: '#111111'
  }
}

describe('mobile terminal theme', () => {
  it('preserves a host terminal theme when it matches the app theme', () => {
    expect(resolveMobileTerminalTheme(darkTheme, runtimeDarkTheme)).toBe(runtimeDarkTheme)
    expect(resolveMobileTerminalTheme(lightTheme, runtimeLightTheme)).toBe(runtimeLightTheme)
  })

  it('uses the Graphite app palette when the host terminal theme conflicts', () => {
    const lightTerminalTheme = resolveMobileTerminalTheme(lightTheme, runtimeDarkTheme)
    const darkTerminalTheme = resolveMobileTerminalTheme(darkTheme, runtimeLightTheme)

    expect(lightTerminalTheme.mode).toBe('light')
    expect(lightTerminalTheme.theme.background).toBe(lightTheme.terminal.background)
    expect(lightTerminalTheme.theme.foreground).toBe(lightTheme.terminal.foreground)
    expect(darkTerminalTheme.mode).toBe('dark')
    expect(darkTerminalTheme.theme.background).toBe(darkTheme.terminal.background)
  })

  it('returns stable fallback objects across renders', () => {
    expect(resolveMobileTerminalTheme(lightTheme, runtimeDarkTheme)).toBe(
      resolveMobileTerminalTheme(lightTheme, runtimeDarkTheme)
    )
  })
})
