import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useRouter } from 'expo-router'
import { RefreshCw, UserRound } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import { useAccountRuntimeDirectory } from '../runtime-directory/account-runtime-directory-provider'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

export function MobileAccountComputerActions() {
  const t = useMobileTranslation()

  const router = useRouter()
  const { hydrated, session } = useMobileAuthSession()
  const { state, refresh } = useAccountRuntimeDirectory()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const syncing = state.status === 'loading' || state.status === 'refreshing'
  const label = session ? '认领新电脑' : '登录 HiveCloud'
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !hydrated }}
        disabled={!hydrated}
        onPress={() => router.push(session ? '/claim-computer' : '/login')}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          !hydrated && styles.disabled
        ]}
      >
        <UserRound size={20} strokeWidth={2} color={theme.color.text.primary} />
        <Text maxFontSizeMultiplier={1.3} style={styles.buttonText}>
          {label}
        </Text>
      </Pressable>
      <Text maxFontSizeMultiplier={1.3} style={styles.description}>
        {session
          ? t(
              'auto.mobile.src.home.MobileAccountComputerActions.cb06cc4f70',
              'Sign in to the same HiveCloud account on your computer and start a claim, then enter the claim code to confirm.'
            )
          : t(
              'auto.mobile.src.home.MobileAccountComputerActions.d04f3ea375',
              'Sign in to HiveCloud to view and connect to computers claimed by your account.'
            )}
      </Text>
      {session ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              'auto.mobile.src.home.MobileAccountComputerActions.3fd6dac79f',
              'Refresh account computers'
            )}
            accessibilityState={{ disabled: syncing, busy: syncing }}
            disabled={syncing}
            onPress={() => void refresh()}
            style={({ pressed }) => [
              styles.refresh,
              pressed && styles.pressed,
              syncing && styles.disabled
            ]}
          >
            <RefreshCw size={16} strokeWidth={2} color={theme.color.text.secondary} />
            <Text maxFontSizeMultiplier={1.3} style={styles.description}>
              {syncing
                ? t(
                    'auto.mobile.src.home.MobileAccountComputerActions.d9d423ac9d',
                    'Syncing account computers…'
                  )
                : t(
                    'auto.mobile.src.home.MobileAccountComputerActions.3fd6dac79f',
                    'Refresh account computers'
                  )}
            </Text>
          </Pressable>
          {state.error ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
              {t(
                'auto.mobile.src.home.MobileAccountComputerActions.26eb3bcf24',
                'Could not sync account computers: '
              )}
              {state.error}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    section: { width: '100%', gap: theme.spacing.space8, paddingVertical: theme.spacing.space12 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: theme.spacing.space8,
      minHeight: theme.size.minimumTouchTarget,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.surface
    },
    buttonText: { ...theme.typography.label, color: theme.color.text.primary, flexShrink: 1 },
    description: {
      ...theme.typography.meta,
      color: theme.color.text.secondary,
      textAlign: 'center'
    },
    refresh: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: theme.size.minimumTouchTarget,
      gap: theme.spacing.space8,
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.5 },
    error: { ...theme.typography.meta, color: theme.color.status.dangerText, textAlign: 'center' }
  })
}
