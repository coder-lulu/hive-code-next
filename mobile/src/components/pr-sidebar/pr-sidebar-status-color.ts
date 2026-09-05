import { darkTheme, type MobileTheme } from '../../theme/mobile-theme'
import type { MobileStatusToken } from './pr-checks-presentation'

// Resolves a pure-logic status token to a concrete mobile-theme color. Keeps the
// presentation module free of style imports while centralizing the mapping.
export function statusColor(token: MobileStatusToken, theme: MobileTheme = darkTheme): string {
  switch (token) {
    case 'statusGreen':
      return theme.color.status.success
    case 'statusAmber':
      return theme.color.status.warning
    case 'statusRed':
      return theme.color.status.danger
    case 'statusPurple':
      return theme.color.brand.primary
    default:
      return theme.color.text.secondary
  }
}

export function statusTextColor(token: MobileStatusToken, theme: MobileTheme = darkTheme): string {
  switch (token) {
    case 'statusGreen':
      return theme.color.status.successText
    case 'statusAmber':
      return theme.color.status.warningText
    case 'statusRed':
      return theme.color.status.dangerText
    case 'statusPurple':
      return theme.color.brand.primary
    default:
      return theme.color.text.secondary
  }
}
