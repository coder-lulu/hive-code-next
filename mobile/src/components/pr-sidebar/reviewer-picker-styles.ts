import { StyleSheet } from 'react-native'
import { TEXT_INPUT_FONT_SIZE } from '../../platform/text-input-font-size'
import type { MobileTheme } from '../../theme/mobile-theme'

export function createReviewerPickerStyles(theme: MobileTheme) {
  return StyleSheet.create({
    title: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary,
      marginBottom: theme.spacing.space8
    },
    search: {
      minHeight: theme.size.minimumTouchTarget,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      color: theme.color.text.primary,
      paddingHorizontal: theme.spacing.space12,
      ...theme.typography.body,
      fontSize: TEXT_INPUT_FONT_SIZE,
      marginBottom: theme.spacing.space8
    },
    list: {
      gap: 0
    },
    row: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingVertical: theme.spacing.space4
    },
    rowMain: {
      flex: 1,
      minWidth: 0
    },
    stateArea: {
      paddingVertical: theme.spacing.space16,
      alignItems: 'center',
      gap: theme.spacing.space8
    }
  })
}
