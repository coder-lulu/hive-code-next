import { describe, expect, it, vi } from 'vitest'

vi.mock('react-native', () => ({
  StyleSheet: {
    hairlineWidth: 1,
    create: <T>(styles: T) => styles
  }
}))

import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createAgentHistoryStyles } from './agent-history-styles'

describe('Agent history Graphite presentation', () => {
  it.each([lightTheme, darkTheme])('uses the $scheme semantic theme', (theme) => {
    const styles = createAgentHistoryStyles(theme)

    expect(styles.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(styles.card).toMatchObject({
      backgroundColor: theme.color.bg.surface,
      borderColor: theme.color.border.subtle,
      borderRadius: theme.radii.card
    })
    expect(styles.scopeTabActive.backgroundColor).toBe(theme.color.bg.selected)
    expect(styles.scopeTabTextActive.color).toBe(theme.color.text.inverse)
    expect(styles.currentBadge.backgroundColor).toBe(theme.color.brand.subtle)
  })

  it('keeps primary controls at the shared minimum touch target', () => {
    const styles = createAgentHistoryStyles(lightTheme)

    expect(styles.backButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.refreshButton.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.scopeTab.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.searchInput.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.resumeButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.retryButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })
})
