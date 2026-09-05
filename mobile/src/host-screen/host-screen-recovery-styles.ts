import { StyleSheet } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'

export function createHostScreenRecoveryStyles(theme: MobileTheme) {
  const { color, radii, size, spacing, typography } = theme
  return StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.space24 },
    errorText: { ...typography.label, color: color.status.dangerText, textAlign: 'center' },
    missingRuntime: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.space12,
      paddingHorizontal: spacing.space24,
      paddingBottom: spacing.space64
    },
    missingRuntimeIcon: {
      width: spacing.space64,
      height: spacing.space64,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.space4,
      borderRadius: radii.circle,
      backgroundColor: color.bg.subtle
    },
    missingRuntimeTitle: { ...typography.sectionTitle, color: color.text.primary },
    missingRuntimeDescription: {
      ...typography.label,
      maxWidth: 320,
      color: color.text.secondary,
      textAlign: 'center'
    },
    missingRuntimeButton: {
      minHeight: size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: spacing.space4,
      paddingHorizontal: spacing.space20,
      borderRadius: radii.control,
      backgroundColor: color.brand.primary
    },
    missingRuntimeButtonText: {
      ...typography.label,
      color: color.text.inverse,
      fontWeight: '600'
    }
  })
}
