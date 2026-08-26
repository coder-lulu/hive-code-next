import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createVoiceSettingsStyles(theme: MobileTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.color.bg.canvas },
    content: {
      gap: theme.spacing.space24,
      paddingHorizontal: theme.spacing.space20,
      paddingTop: theme.spacing.space20
    },
    centerState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space20
    },
    notice: {
      width: '100%',
      gap: theme.spacing.space8,
      padding: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    noticeTitle: { ...theme.typography.sectionTitle, color: theme.color.text.primary },
    noticeDetail: { ...theme.typography.meta, color: theme.color.text.secondary },
    stateText: { ...theme.typography.meta, color: theme.color.text.secondary },
    row: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    modeRow: {
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12
    },
    rowCopy: { minWidth: 0, flex: 1, gap: theme.spacing.space4 },
    rowTitle: { ...theme.typography.body, color: theme.color.text.primary },
    rowDetail: { ...theme.typography.meta, color: theme.color.text.secondary },
    errorNotice: {
      width: '100%',
      padding: theme.spacing.space16,
      borderWidth: 1,
      borderColor: theme.color.status.danger,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    errorText: { ...theme.typography.meta, color: theme.color.status.danger },
    drawerTitle: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space16,
      paddingTop: theme.spacing.space8,
      paddingBottom: theme.spacing.space4
    }
  })
}
