import { describe, expect, it } from 'vitest'
import {
  componentSizeTokens,
  darkTheme,
  lightTheme,
  mobileThemes,
  radii,
  radiusTokens,
  spacingTokens,
  typographyTokens
} from './mobile-theme'

function channelLuminance(channel: number): number {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16)
  const green = Number.parseInt(hex.slice(3, 5), 16)
  const blue = Number.parseInt(hex.slice(5, 7), 16)
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  )
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('mobile semantic themes', () => {
  it('provides matching light and dark theme structures', () => {
    expect(Object.keys(lightTheme.color)).toEqual(Object.keys(darkTheme.color))
    expect(mobileThemes.light).toBe(lightTheme)
    expect(mobileThemes.dark).toBe(darkTheme)
    expect(lightTheme.scheme).toBe('light')
    expect(darkTheme.scheme).toBe('dark')
  })

  it.each([lightTheme, darkTheme])(
    '$scheme theme meets critical WCAG AA text contrast',
    (theme) => {
      const surfaces = [theme.color.bg.canvas, theme.color.bg.surface, theme.color.bg.elevated]
      for (const surface of surfaces) {
        expect(contrastRatio(theme.color.text.primary, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(theme.color.text.secondary, surface)).toBeGreaterThanOrEqual(4.5)
      }
      expect(
        contrastRatio(theme.color.text.inverse, theme.color.bg.selected)
      ).toBeGreaterThanOrEqual(4.5)
      for (const surface of surfaces) {
        expect(contrastRatio(theme.color.status.successText, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(theme.color.status.warningText, surface)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(theme.color.status.dangerText, surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it('uses only the approved spacing scale', () => {
    expect(Object.values(spacingTokens)).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
  })

  it('defines shared minimum interaction and navigation sizes', () => {
    expect(componentSizeTokens.minimumTouchTarget).toBeGreaterThanOrEqual(44)
    expect(componentSizeTokens.navigationBarHeight).toBe(56)
    expect(componentSizeTokens.compactLayoutBreakpoint).toBe(380)
    expect(componentSizeTokens.primaryNavigationHeight).toBe(70)
    expect(componentSizeTokens.activeIndicatorHeight).toBe(2)
    expect(componentSizeTokens.floatingActionButtonSize).toBe(48)
    expect(componentSizeTokens.groupedListRowMinHeight).toBe(56)
  })

  it('rejects illegal non-circular radii from semantic and compatibility tokens', () => {
    const allowed = new Set([4, 8, 12, 16])
    for (const [name, value] of Object.entries(radiusTokens)) {
      if (name !== 'circle') {
        expect(allowed.has(value)).toBe(true)
      }
    }
    for (const value of Object.values(radii)) {
      expect(allowed.has(value)).toBe(true)
    }
    expect(radiusTokens.circle).toBeGreaterThan(16)
  })

  it('uses only the documented typography size and line-height pairs', () => {
    const pairs = new Set(['30/38', '20/28', '16/24', '15/22', '14/20', '13/18', '12/16', '13/20'])
    for (const token of Object.values(typographyTokens)) {
      expect(pairs.has(`${token.fontSize}/${token.lineHeight}`)).toBe(true)
      expect(['400', '500', '600']).toContain(token.fontWeight)
    }
  })
})
