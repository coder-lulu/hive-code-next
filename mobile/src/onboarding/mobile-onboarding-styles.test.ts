import { describe, expect, it, vi } from 'vitest'
import { darkTheme, lightTheme } from '../theme/mobile-theme'
import { createMobileOnboardingStyles } from './mobile-onboarding-styles'

vi.mock('react-native', () => ({
  StyleSheet: { create: (styles: unknown) => styles }
}))

describe('mobile onboarding Graphite styles', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme]
  ] as const)('uses %s semantic surfaces and typography', (_scheme, theme) => {
    const styles = createMobileOnboardingStyles(theme)

    expect(styles.container.backgroundColor).toBe(theme.color.bg.canvas)
    expect(styles.iconSurface).toMatchObject({
      backgroundColor: theme.color.bg.surface,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card
    })
    expect(styles.title).toMatchObject({
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    })
    expect(styles.body).toMatchObject({
      ...theme.typography.body,
      color: theme.color.text.secondary
    })
    expect(styles.choiceButton).toMatchObject({
      minHeight: 48,
      borderRadius: theme.radii.control
    })
    expect(styles.primaryButton.backgroundColor).toBe(theme.color.bg.selected)
    expect(styles.primaryButtonText.color).toBe(theme.color.text.inverse)
    expect(styles.secondaryButton).toMatchObject({
      backgroundColor: theme.color.bg.surface,
      borderColor: theme.color.border.default
    })
    expect(styles.error.color).toBe(theme.color.status.danger)
  })
})
