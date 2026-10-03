import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export type AuthFailedBannerCopy = {
  readonly message: string
  readonly retry: string
  readonly retryAccessibility: string
  readonly repair: string
  readonly repairAccessibility: string
  readonly remove: string
  readonly removeAccessibility: string
}

export type AuthFailedBannerActionProps = {
  canRetry: boolean
  copy: AuthFailedBannerCopy
  styles: ReturnType<typeof createAuthFailedBannerStyles>
  onRetry: () => void
  onRepair: () => void
  onRemove?: () => void
}

export function createAuthFailedBannerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      backgroundColor: theme.color.bg.surface
    },
    content: { flex: 1, minWidth: 0 },
    text: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.space8,
      marginTop: theme.spacing.space8
    },
    action: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space12,
      borderRadius: theme.radii.control
    },
    retryAction: { backgroundColor: theme.color.bg.selected },
    secondaryAction: {
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    pressed: { opacity: 0.72 },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    secondaryText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    note: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      flexShrink: 1,
      paddingVertical: theme.spacing.space4
    },
    removeText: {
      ...theme.typography.label,
      color: theme.color.status.dangerText
    }
  })
}
