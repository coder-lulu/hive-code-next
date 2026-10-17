import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { TaskProviderLogo } from './TaskProviderLogo'
import { productNameText } from '@/product-brand'

type Props = {
  credentialError: string | null
  unavailableReason: string | null
  disabled: boolean
  onCheckAgain: () => void
}

// Jira credentials are managed on the paired desktop.
export function JiraConnectPrompt({
  credentialError,
  unavailableReason,
  disabled,
  onCheckAgain
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  return (
    <View style={styles.centered}>
      <TaskProviderLogo provider="jira" size={24} color={theme.color.text.secondary} />
      <Text style={styles.emptyText}>
        {unavailableReason
          ? productNameText('Update Orca desktop')
          : 'Connect Jira on your desktop'}
      </Text>
      <Text style={styles.centeredHint}>
        {unavailableReason ??
          (credentialError
            ? `Jira is saved but unreadable: ${credentialError}`
            : productNameText(
                'Add your Jira site in Orca desktop under Settings → Integrations, then check again.'
              ))}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Check Jira connection again"
        style={({ pressed }) => [
          styles.checkAgainButton,
          pressed && styles.pressed,
          disabled && styles.disabled
        ]}
        disabled={disabled}
        onPress={() => {
          if (!disabled) {
            onCheckAgain()
          }
        }}
      >
        <Text style={styles.checkAgainText}>Check again</Text>
      </Pressable>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyText: { ...theme.typography.body, color: theme.color.text.secondary },
    centeredHint: {
      ...theme.typography.caption,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space8,
      maxWidth: 280,
      textAlign: 'center'
    },
    checkAgainButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.size.minimumTouchTarget,
      borderWidth: 1,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      marginTop: theme.spacing.space16,
      minWidth: 160
    },
    checkAgainText: { ...theme.typography.label, color: theme.color.text.primary },
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.5 }
  })
}
