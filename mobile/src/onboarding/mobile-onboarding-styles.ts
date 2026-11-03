import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { themedStyleSheet } from '../theme/themed-styles'

export const mobileOnboardingStyles = themedStyleSheet(() => ({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  brandRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl
  },
  brandName: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700'
  },
  progress: {
    position: 'absolute',
    left: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    transform: [{ translateX: -18 }]
  },
  progressDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.borderSubtle
  },
  progressDotActive: {
    width: 22,
    backgroundColor: colors.textPrimary
  },
  carouselViewport: {
    flex: 1,
    overflow: 'hidden'
  },
  carouselTrack: {
    height: '100%',
    flexDirection: 'row'
  },
  page: {
    height: '100%'
  },
  // Allow landscape/accessibility scrolling because Back and swipe-to-skip are disabled.
  pageContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.md
  },
  notificationContent: {
    justifyContent: 'flex-start',
    paddingTop: spacing.xl
  },
  iconSurface: {
    width: 64,
    height: 64,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    marginBottom: spacing.xl
  },
  title: {
    maxWidth: 420,
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center'
  },
  body: {
    maxWidth: 420,
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: spacing.md
  },
  footer: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingBottom: spacing.lg
  },
  disclosure: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg
  },
  primaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.surfaceBright,
    paddingVertical: spacing.sm
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  secondaryButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  buttonPressed: {
    opacity: 0.72
  },
  buttonDisabled: {
    opacity: 0.58
  },
  error: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.sm
  }
}))

export function createMobileOnboardingStyles(theme: MobileTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.color.bg.canvas
    },
    brandRow: {
      minHeight: theme.size.navigationBarHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space20
    },
    brandName: {
      ...theme.typography.sectionTitle,
      color: theme.color.text.primary
    },
    progress: {
      minHeight: theme.size.minimumTouchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      marginLeft: 'auto'
    },
    progressDot: {
      width: theme.spacing.space4,
      height: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.border.default
    },
    progressDotActive: {
      width: theme.spacing.space20,
      backgroundColor: theme.color.text.primary
    },
    carouselViewport: {
      flex: 1,
      overflow: 'hidden'
    },
    carouselTrack: {
      height: '100%',
      flexDirection: 'row'
    },
    page: {
      height: '100%',
      backgroundColor: theme.color.bg.canvas
    },
    // Why: scrolling keeps both decisions reachable on short screens and at 130% text size.
    pageContent: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing.space20
    },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: theme.spacing.space24
    },
    iconSurface: {
      width: theme.spacing.space64,
      height: theme.spacing.space64,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing.space24,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.card,
      backgroundColor: theme.color.bg.surface
    },
    title: {
      ...theme.typography.pageTitle,
      maxWidth: 420,
      color: theme.color.text.primary,
      textAlign: 'center'
    },
    body: {
      ...theme.typography.body,
      maxWidth: 420,
      color: theme.color.text.secondary,
      textAlign: 'center',
      marginTop: theme.spacing.space12
    },
    footer: {
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
      gap: theme.spacing.space8,
      paddingBottom: theme.spacing.space16
    },
    choiceButton: {
      minHeight: theme.spacing.space48,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      borderWidth: 1,
      borderRadius: theme.radii.control
    },
    primaryButton: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    primaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.inverse,
      fontWeight: '600'
    },
    secondaryButton: {
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface
    },
    secondaryButtonText: {
      ...theme.typography.label,
      color: theme.color.text.primary
    },
    buttonPressed: {
      opacity: 0.72
    },
    buttonDisabled: {
      opacity: 0.4
    },
    error: {
      ...theme.typography.meta,
      color: theme.color.status.dangerText,
      textAlign: 'center'
    }
  })
}
