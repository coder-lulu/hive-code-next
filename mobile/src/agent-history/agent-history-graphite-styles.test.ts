import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  Platform: { select: (choices: Record<string, unknown>) => choices.default },
  StyleSheet: { hairlineWidth: 1, create: <T>(styles: T) => styles }
}))

import { styles } from './agent-history-styles'
import {
  applyMobileColorScheme,
  paletteForScheme,
  radii,
  spacing,
  typography
} from '../theme/mobile-theme'

afterEach(() => applyMobileColorScheme('dark'))

describe('Agent history live presentation', () => {
  it.each(['light', 'dark', 'light'] as const)(
    'uses the %s palette without rebuilding the import',
    (scheme) => {
      applyMobileColorScheme(scheme)
      const palette = paletteForScheme(scheme)
      expect(styles.container.backgroundColor).toBe(palette.bgBase)
      expect(styles.card).toMatchObject({
        backgroundColor: palette.bgPanel,
        borderRadius: radii.card,
        padding: spacing.md
      })
      expect(styles.scopeTabActive.backgroundColor).toBe(palette.bgRaised)
      expect(styles.scopeTabTextActive.color).toBe(palette.textPrimary)
      expect(styles.currentBadge.backgroundColor).toBe(palette.bgRaised)
    }
  )

  it('keeps compact history controls padded and resume affordances sized', () => {
    expect(styles.backButton.padding).toBe(spacing.xs)
    expect(styles.refreshButton.padding).toBe(spacing.xs)
    expect(styles.scopeTab.paddingVertical).toBe(spacing.sm)
    expect(styles.resumeButton).toMatchObject({
      minHeight: 28,
      minWidth: 28,
      paddingVertical: spacing.xs
    })
    expect(styles.retryButton.paddingVertical).toBe(spacing.sm)
    expect(styles.cardTitle.fontSize).toBe(typography.bodySize)
  })
})
