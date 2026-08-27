import { colors as legacyColors, type MobileTheme } from '../theme/mobile-theme'

export function createMobileTaskScreenPalette(theme: MobileTheme) {
  return {
    canvas: theme.color.bg.canvas,
    surface: theme.color.bg.surface,
    subtle: theme.color.bg.subtle,
    selected: theme.color.bg.selected,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary,
    textTertiary: theme.color.text.tertiary,
    textInverse: theme.color.text.inverse,
    borderDefault: theme.color.border.default,
    borderSubtle: theme.color.border.subtle,
    brand: theme.color.brand.primary,
    success: theme.color.status.success,
    warning: theme.color.status.warning,
    danger: theme.color.status.danger
  }
}

export function createMobileTaskCompatColors(theme: MobileTheme) {
  return {
    ...legacyColors,
    bgBase: theme.color.bg.canvas,
    bgPanel: theme.color.bg.surface,
    bgRaised: theme.color.bg.subtle,
    borderSubtle: theme.color.border.subtle,
    editorSurface: theme.color.bg.elevated,
    textPrimary: theme.color.text.primary,
    textSecondary: theme.color.text.secondary,
    textMuted: theme.color.text.tertiary,
    surfaceBright: theme.color.text.inverse,
    accentBlue: theme.color.brand.primary,
    onAccent: theme.color.text.inverse,
    statusGreen: theme.color.status.success,
    statusAmber: theme.color.status.warning,
    statusRed: theme.color.status.danger,
    mergeGreen: theme.color.status.success,
    onMergeGreen: theme.color.text.inverse
  }
}
