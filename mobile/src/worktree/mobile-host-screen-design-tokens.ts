import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileHostScreenDesignTokens(theme: MobileTheme) {
  return {
    colors: {
      bgBase: theme.color.bg.canvas,
      bgPanel: theme.color.bg.surface,
      bgRaised: theme.color.bg.subtle,
      borderSubtle: theme.color.border.subtle,
      textPrimary: theme.color.text.primary,
      textSecondary: theme.color.text.secondary,
      textMuted: theme.color.text.tertiary,
      statusRed: theme.color.status.danger,
      onAccent: theme.color.text.inverse
    },
    spacing: {
      xs: theme.spacing.space4,
      sm: theme.spacing.space8,
      md: theme.spacing.space12,
      lg: theme.spacing.space16,
      xl: theme.spacing.space24
    }
  }
}
