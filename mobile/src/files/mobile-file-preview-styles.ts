import { darkTheme, type MobileTheme } from '../theme/mobile-theme'
import { StyleSheet } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

export const filePreviewStyles = themedStyleSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  header: {
    backgroundColor: colors.bgPanel,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  topBar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button
  },
  backButtonPressed: {
    backgroundColor: colors.bgRaised
  },
  titleBlock: {
    flex: 1,
    minWidth: 0
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '600'
  },
  meta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl
  },
  stateText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    textAlign: 'center'
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    textAlign: 'center'
  },
  saveButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  saveButtonDisabled: {
    opacity: 0.42
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.editorSurface
  },
  textContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl
  },
  textPreview: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: 13,
    lineHeight: 19
  },
  markdownContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl
  },
  modeContainer: {
    flex: 1,
    backgroundColor: colors.editorSurface
  },
  modeToolbar: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
    padding: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  modeToggle: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.row,
    backgroundColor: 'transparent',
    opacity: 0.72
  },
  modeToggleActive: {
    backgroundColor: colors.bgRaised,
    opacity: 1
  },
  truncatedNote: {
    marginBottom: spacing.md,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  imageContainer: {
    flex: 1,
    backgroundColor: colors.editorSurface
  },
  imageScrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md
  },
  image: {
    backgroundColor: colors.editorSurface
  },
  editContainer: {
    flex: 1,
    backgroundColor: colors.editorSurface,
    padding: spacing.md
  },
  saveErrorText: {
    marginBottom: spacing.sm,
    color: colors.statusRed,
    fontSize: typography.metaSize
  },
  editInput: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: 13,
    lineHeight: 19,
    padding: 0
  }
}))

export function createFilePreviewStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    header: {
      backgroundColor: theme.color.bg.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    topBar: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12
    },
    backButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    backButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    titleBlock: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...theme.typography.pageTitle,
      color: theme.color.text.primary
    },
    meta: {
      ...theme.typography.caption,
      marginTop: theme.spacing.space4,
      color: theme.color.text.secondary
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space12,
      padding: theme.spacing.space24
    },
    stateText: {
      ...theme.typography.body,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    errorText: {
      ...theme.typography.body,
      color: theme.color.status.dangerText,
      textAlign: 'center'
    },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      paddingHorizontal: theme.spacing.space16
    },
    retryText: {
      ...theme.typography.label,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    saveButton: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.selected
    },
    saveButtonDisabled: {
      opacity: 0.42
    },
    scroll: {
      flex: 1,
      backgroundColor: theme.color.bg.surface
    },
    sourceScroll: {
      flex: 1,
      backgroundColor: darkTheme.color.bg.surface
    },
    textContent: {
      padding: theme.spacing.space16,
      paddingBottom: theme.spacing.space24
    },
    textPreview: {
      ...theme.typography.code,
      color: darkTheme.color.text.primary
    },
    markdownContent: {
      padding: theme.spacing.space16,
      paddingBottom: theme.spacing.space24
    },
    modeContainer: {
      flex: 1,
      backgroundColor: theme.color.bg.surface
    },
    modeToolbar: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      marginHorizontal: theme.spacing.space16,
      marginVertical: theme.spacing.space8,
      padding: theme.spacing.space4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.subtle
    },
    modeToggle: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      backgroundColor: 'transparent'
    },
    modeToggleActive: {
      backgroundColor: theme.color.bg.selected
    },
    truncatedNote: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space12,
      color: theme.color.text.secondary
    },
    imageContainer: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    imageScrollContent: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space16
    },
    image: {
      backgroundColor: theme.color.bg.surface
    },
    editContainer: {
      flex: 1,
      backgroundColor: darkTheme.color.bg.surface,
      padding: theme.spacing.space16
    },
    saveErrorText: {
      ...theme.typography.caption,
      marginBottom: theme.spacing.space8,
      color: theme.color.status.dangerText
    },
    editInput: {
      ...theme.typography.code,
      flex: 1,
      padding: 0,
      color: darkTheme.color.text.primary
    }
  })
}
