import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createHostScreenViewPickerStyles(theme: MobileTheme) {
  const { color, radii, size, spacing, typography } = theme
  return StyleSheet.create({
    filterModalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.space16
    },
    filterModalHeading: { flexShrink: 1 },
    filterModalTitle: { ...typography.sectionTitle, color: color.text.primary },
    filterModalSubtitle: {
      ...typography.caption,
      color: color.text.secondary,
      marginTop: spacing.space4
    },
    clearFiltersText: { ...typography.meta, color: color.brand.primary, fontWeight: '600' },
    filterSectionLabel: {
      marginBottom: spacing.space8,
      color: color.text.tertiary,
      ...typography.caption,
      fontWeight: '600',
      textTransform: 'uppercase'
    },
    filterGroup: {
      marginBottom: spacing.space16,
      overflow: 'hidden',
      borderRadius: radii.control,
      backgroundColor: color.bg.elevated
    },
    filterRow: {
      minHeight: size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.space12,
      gap: spacing.space8
    },
    filterRowText: { ...typography.label, flex: 1, color: color.text.primary },
    filterRowValue: { ...typography.meta, color: color.text.secondary },
    filterSeparator: {
      height: 1,
      marginLeft: spacing.space12,
      backgroundColor: color.border.subtle
    },
    filterRepoDot: {
      width: spacing.space8,
      height: spacing.space8,
      borderRadius: radii.circle
    }
  })
}
