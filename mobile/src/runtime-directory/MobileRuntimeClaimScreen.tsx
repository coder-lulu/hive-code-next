import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { useState } from 'react'
import { useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { useAccountRuntimeDirectory } from './account-runtime-directory-provider'
import { createMobileRuntimeClaimStyles } from './mobile-runtime-claim-styles'
import { useMobileRuntimeClaim } from './use-mobile-runtime-claim'
import { hostOs } from '../platform/host-os'
import { useKeyboardOcclusion } from '../platform/keyboard-occlusion'

function ClaimAction({
  children,
  onPress,
  disabled = false,
  secondary = false
}: {
  children: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
}) {
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={children}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        secondary && styles.secondary,
        disabled && styles.disabled,
        pressed && styles.pressed
      ]}
    >
      <Text
        maxFontSizeMultiplier={1.3}
        style={[styles.actionText, secondary && styles.secondaryText]}
      >
        {children}
      </Text>
    </Pressable>
  )
}

export function MobileRuntimeClaimScreen() {
  const t = useMobileTranslation()

  const router = useRouter()
  const { hydrated, session } = useMobileAuthSession()
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardOcclusion()
  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView
        behavior={hostOs() === 'ios' ? 'padding' : undefined}
        style={[
          styles.viewport,
          hostOs() === 'android' && { marginBottom: Math.max(0, keyboardHeight - insets.bottom) }
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back', 'Back')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <ArrowLeft size={24} strokeWidth={2} color={theme.color.text.primary} />
          </Pressable>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.750a727be2',
              'Claim computer'
            )}
          </Text>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.content, isWideLayout && { maxWidth: contentMaxWidth }]}
        >
          {!hydrated ? (
            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.904613f373',
                'Reading account…'
              )}
            </Text>
          ) : session ? (
            <SignedInClaimForm
              key={`${session.authorityId}:${session.account.accountId}`}
              session={session}
            />
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                {t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.7cdde1f2ad',
                  'Sign in to the same HiveCloud account used on your computer, then enter the claim code to confirm the computer.'
                )}
              </Text>
              <ClaimAction onPress={() => router.push('/login')}>
                {t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.1dd1c45a66',
                  'Sign in to HiveCloud'
                )}
              </ClaimAction>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SignedInClaimForm({ session }: { session: MobileSession }) {
  const t = useMobileTranslation()

  const router = useRouter()
  const directory = useAccountRuntimeDirectory()
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const theme = useMobileTheme()
  const claim = useMobileRuntimeClaim(session)
  const [focused, setFocused] = useState<'claim' | 'sms' | null>(null)
  const viewComputers = () => {
    void directory.refresh()
    router.replace('/')
  }
  if (claim.approved) {
    return (
      <View style={styles.form}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.label}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.f4fe1279b6',
            'Claim confirmed'
          )}
        </Text>
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.508f4095f0',
            'Return to your computer to finish linking it. Once linked, the computer will appear on this account’s home page and device list.'
          )}
        </Text>
        <ClaimAction onPress={viewComputers}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.526cda3915',
            'View my computers'
          )}
        </ClaimAction>
      </View>
    )
  }
  return (
    <View style={styles.form}>
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        {t(
          'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.9fdb3ba07d',
          'Sign in to the same HiveCloud account in your computer’s connection settings, start a device claim, and enter the claim code shown there.'
        )}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
        {t(
          'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.309caf2496',
          'Current account: '
        )}
        {session.account.displayName}
      </Text>
      {!claim.preview ? (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.8b77a05a30',
              'Claim code'
            )}
          </Text>
          <TextInput
            accessibilityLabel={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.051c4a18dc',
              'Computer claim code'
            )}
            placeholder={t(
              'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.668f5d86e0',
              'ABCD-EFGH'
            )}
            placeholderTextColor={theme.color.text.tertiary}
            value={claim.code}
            onChangeText={claim.setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={9}
            maxFontSizeMultiplier={1.3}
            editable={!claim.busy && !claim.uncertain && !claim.requiresLogin}
            onFocus={() => setFocused('claim')}
            onBlur={() => setFocused(null)}
            onSubmitEditing={() => void claim.review()}
            returnKeyType="go"
            style={[styles.input, focused === 'claim' && styles.focused]}
          />
          <ClaimAction
            disabled={claim.busy || claim.uncertain || claim.requiresLogin || !claim.code.trim()}
            onPress={() => void claim.review()}
          >
            {claim.busy
              ? t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.c4b3ad345a',
                  'Checking…'
                )
              : t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.4daac65445',
                  'View computer awaiting claim'
                )}
          </ClaimAction>
        </>
      ) : (
        <>
          <View style={styles.details}>
            <Text maxFontSizeMultiplier={1.3} style={styles.label}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.f0b07fd798',
                'Check that this is the computer you requested to claim'
              )}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.value}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.73c955fb60',
                'Claim code: '
              )}
              {claim.code}
            </Text>
            <Text selectable maxFontSizeMultiplier={1.3} style={styles.hint}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.20ddea628e',
                'Computer ID: '
              )}
              {claim.preview.runtimeRecordId}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
              {t(
                'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.fbf37c2ffa',
                'HiveCode version: '
              )}
              {claim.preview.runtimeVersion}
            </Text>
          </View>
          {claim.sms ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
                style={styles.body}
              >
                {t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.cf08d5eabf',
                  'Verification code sent to '
                )}
                {claim.sms.phoneNumberMasked}
              </Text>
              <TextInput
                accessibilityLabel={t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.012b3628ff',
                  'Claim SMS verification code'
                )}
                placeholder={t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.f8f9d7c2d3',
                  'Six-digit verification code'
                )}
                placeholderTextColor={theme.color.text.tertiary}
                value={claim.smsCode}
                onChangeText={claim.setSmsCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                maxFontSizeMultiplier={1.3}
                editable={!claim.unavailable && !claim.smsExpired}
                onFocus={() => setFocused('sms')}
                onBlur={() => setFocused(null)}
                style={[styles.input, focused === 'sms' && styles.focused]}
              />
              <ClaimAction
                disabled={claim.unavailable || claim.smsExpired || !/^\d{6}$/.test(claim.smsCode)}
                onPress={() => void claim.confirm()}
              >
                {claim.busy
                  ? t(
                      'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.f3f1601ce0',
                      'Confirming…'
                    )
                  : t(
                      'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.da4bbd0ad0',
                      'Verify and confirm claim'
                    )}
              </ClaimAction>
            </>
          ) : null}
          <ClaimAction
            secondary={!!claim.sms}
            disabled={claim.unavailable || claim.resendRemaining > 0}
            onPress={() => void claim.sendSms()}
          >
            {claim.resendRemaining > 0
              ? t(
                  'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.b2316a4dca',
                  'Resend in {{value0}}s',
                  { value0: claim.resendRemaining }
                )
              : claim.sms
                ? t(
                    'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.05f5b8cbbd',
                    'Resend verification code'
                  )
                : t(
                    'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.c91f5ffa64',
                    'Send verification code to your linked phone number'
                  )}
          </ClaimAction>
          <ClaimAction secondary disabled={claim.busy || claim.uncertain} onPress={claim.reset}>
            {t(
              'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.75ec8ec840',
              'Enter claim code again'
            )}
          </ClaimAction>
        </>
      )}
      {claim.expired ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.026364dcb1',
            'The claim request expired. Start it again on your computer.'
          )}
        </Text>
      ) : null}
      {claim.smsExpired && !claim.expired ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.39cf8a99c0',
            'The verification code expired. Send a new one.'
          )}
        </Text>
      ) : null}
      {claim.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {claim.error}
        </Text>
      ) : null}
      {claim.requiresLogin ? (
        <ClaimAction onPress={() => router.push('/login')}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.a0bfe787f6',
            'Sign in again'
          )}
        </ClaimAction>
      ) : null}
      {claim.uncertain ? (
        <ClaimAction secondary onPress={viewComputers}>
          {t(
            'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.526cda3915',
            'View my computers'
          )}
        </ClaimAction>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
        {t(
          'auto.mobile.src.runtime.directory.MobileRuntimeClaimScreen.3a2a5963d2',
          'Claiming grants this account cloud access only. Connection status depends on whether the computer is online.'
        )}
      </Text>
    </View>
  )
}
