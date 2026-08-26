import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createMobileNativeChatViewStyles(theme: MobileTheme) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    chromeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space12
    },
    chromeLeft: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    stopButton: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8
    },
    stopLabel: {
      ...theme.typography.meta,
      color: theme.color.status.danger,
      fontWeight: '600'
    },
    sendError: {
      alignItems: 'center',
      paddingHorizontal: theme.spacing.space12,
      paddingBottom: theme.spacing.space4
    },
    sendErrorText: {
      ...theme.typography.meta,
      color: theme.color.status.danger,
      fontWeight: '600'
    },
    chromeToggle: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8
    },
    chromeToggleLabel: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    },
    pressed: {
      opacity: 0.64
    },
    listWrap: {
      flex: 1,
      position: 'relative'
    },
    listContent: {
      paddingVertical: theme.spacing.space8,
      flexGrow: 1
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space24
    },
    emptyTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginBottom: theme.spacing.space4
    },
    emptySubtitle: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      textAlign: 'center'
    },
    fab: {
      position: 'absolute',
      right: theme.spacing.space12,
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default
    },
    fabBottom: {
      bottom: theme.spacing.space12
    },
    loadEarlier: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space12
    },
    loadEarlierText: {
      ...theme.typography.meta,
      color: theme.color.text.tertiary,
      fontWeight: '600'
    }
  })
}
