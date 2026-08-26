import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { RotateCcw } from 'lucide-react-native'
import { lightTheme, type MobileTheme } from '../theme/mobile-theme'
import type { CodexResetCreditSummary } from './codex-reset-credit'

export function CodexResetCreditAction({
  summary,
  scopeLabel,
  busy,
  disabled,
  onPress,
  theme = lightTheme
}: {
  summary: CodexResetCreditSummary
  scopeLabel?: string | null
  busy: boolean
  disabled: boolean
  onPress: () => void
  theme?: MobileTheme
}) {
  const styles = createStyles(theme)
  return (
    <>
      <View style={styles.separator} />
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>{summary.availabilityLabel}</Text>
          <Text style={styles.subtitle}>
            {[summary.expiryLabel, scopeLabel].filter(Boolean).join(' · ') ||
              'Earned Codex rate-limit reset'}
          </Text>
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            disabled && styles.buttonDisabled,
            pressed && !disabled && styles.buttonPressed
          ]}
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Resetting Codex rate limits' : 'Use Codex rate-limit reset'}
          accessibilityHint={
            scopeLabel
              ? `Uses one earned reset for ${scopeLabel}`
              : 'Uses one earned reset for the active Codex account'
          }
          accessibilityState={{ busy, disabled }}
          hitSlop={8}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.color.text.primary} />
          ) : (
            <RotateCcw size={14} color={theme.color.text.primary} />
          )}
          <Text style={styles.buttonText}>{busy ? 'Resetting…' : 'Use reset'}</Text>
        </Pressable>
      </View>
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.color.border.subtle,
      marginHorizontal: theme.spacing.space16
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16
    },
    copy: {
      flex: 1,
      gap: theme.spacing.space4
    },
    title: {
      ...theme.typography.body,
      fontWeight: '500',
      color: theme.color.text.primary
    },
    subtitle: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    button: {
      minHeight: 44,
      width: 104,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    buttonPressed: {
      opacity: 0.72
    },
    buttonDisabled: {
      opacity: 0.5
    },
    buttonText: {
      ...theme.typography.meta,
      fontWeight: '600',
      color: theme.color.text.primary
    }
  })
}
