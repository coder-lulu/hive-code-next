import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

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
      color: theme.color.status.danger,
      textAlign: 'center'
    }
  })
}
