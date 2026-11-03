import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { ArrowLeft } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { loginWithMobileSms, requestMobileSms, type MobileSession } from './mobile-sms-auth'
import { createMobileSmsLoginStyles } from './mobile-sms-login-styles'
import { hostOs } from '../platform/host-os'
import { useKeyboardOcclusion } from '../platform/keyboard-occlusion'

type MobileSmsLoginFormProps = {
  readonly onClose: () => void
  readonly onSuccess: (session: MobileSession) => void | Promise<void>
  readonly termsAccepted: boolean
}

export function MobileSmsLoginForm({ onClose, onSuccess, termsAccepted }: MobileSmsLoginFormProps) {
  const t = useMobileTranslation()

  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSmsLoginStyles)
  const insets = useSafeAreaInsets()
  const [phoneNumber, setPhoneNumber] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState<'phone' | 'code' | null>(null)
  const keyboardHeight = useKeyboardOcclusion()

  useEffect(() => {
    if (countdown <= 0) {
      return
    }
    const timer = setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const validPhone = /^1[3-9]\d{9}$/.test(phoneNumber)
  const validCode = /^\d{6}$/.test(smsCode)
  const canSend = validPhone && countdown === 0 && !busy
  const canLogin = Boolean(challengeId) && validPhone && validCode && !busy
  const inputStyle = (name: 'phone' | 'code') => [
    styles.input,
    focused === name && styles.inputFocused
  ]

  async function sendCode() {
    if (!canSend) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const challenge = await requestMobileSms(`+86${phoneNumber}`, termsAccepted)
      setChallengeId(challenge.challengeId)
      setSmsCode('')
      setCountdown(challenge.resendAfterSeconds)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '验证码发送失败，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!canLogin || !challengeId) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const session = await loginWithMobileSms(
        `+86${phoneNumber}`,
        smsCode,
        challengeId,
        termsAccepted
      )
      await onSuccess(session)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '登录失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={hostOs() === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <Pressable
        accessibilityLabel={t(
          'auto.mobile.src.auth.MobileSmsLoginForm.0cc5baccbd',
          'Close phone sign-in'
        )}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + theme.spacing.space24,
            marginBottom: hostOs() === 'android' ? keyboardHeight : 0
          }
        ]}
      >
        <View style={styles.topRow}>
          <Pressable
            accessibilityLabel={t(
              'auto.mobile.src.auth.MobileSmsLoginForm.9b3c193464',
              'Back to sign-in options'
            )}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ArrowLeft color={theme.color.text.primary} size={20} strokeWidth={1.9} />
          </Pressable>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
            {t(
              'auto.mobile.src.auth.MobileSmsLoginForm.db7f60aec7',
              'Sign in or register with phone number'
            )}
          </Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
            {t(
              'auto.mobile.src.auth.MobileSmsLoginForm.48aaa96f37',
              'A verification code will be sent to your phone number.'
            )}
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.inputLabel}>
            {t('auto.mobile.src.auth.MobileSmsLoginForm.dd1b7afb0e', 'Phone number')}
          </Text>
          <TextInput
            accessibilityLabel={t(
              'auto.mobile.src.auth.MobileSmsLoginForm.dd1b7afb0e',
              'Phone number'
            )}
            autoComplete="tel"
            autoCorrect={false}
            keyboardType="phone-pad"
            maxLength={11}
            onBlur={() => setFocused(null)}
            onChangeText={(value) => setPhoneNumber(value.replace(/\D/g, '').slice(0, 11))}
            onFocus={() => setFocused('phone')}
            placeholder={t(
              'auto.mobile.src.auth.MobileSmsLoginForm.ee385b7714',
              'Enter an 11-digit phone number'
            )}
            placeholderTextColor={theme.color.text.tertiary}
            style={inputStyle('phone')}
            value={phoneNumber}
          />
          <Pressable
            accessibilityLabel={
              countdown > 0
                ? t(
                    'auto.mobile.src.auth.MobileSmsLoginForm.04f0eea0ef',
                    'Verification code countdown: {{value0}}s',
                    { value0: countdown }
                  )
                : t('auto.mobile.src.auth.MobileSmsLoginForm.84bfac9bc3', 'Send verification code')
            }
            accessibilityRole="button"
            accessibilityState={{ busy, disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void sendCode()}
            style={({ pressed }) => [
              styles.action,
              pressed && styles.pressed,
              !canSend && styles.actionDisabled
            ]}
          >
            {busy && !challengeId ? (
              <ActivityIndicator color={theme.color.text.inverse} />
            ) : (
              <Text style={styles.actionLabel}>
                {challengeId
                  ? countdown > 0
                    ? t(
                        'auto.mobile.src.auth.MobileSmsLoginForm.ecfb4979c0',
                        'Resend in {{value0}}s',
                        { value0: countdown }
                      )
                    : t(
                        'auto.mobile.src.auth.MobileSmsLoginForm.a2e3e19a24',
                        'Resend verification code'
                      )
                  : t(
                      'auto.mobile.src.auth.MobileSmsLoginForm.84bfac9bc3',
                      'Send verification code'
                    )}
              </Text>
            )}
          </Pressable>
          {challengeId ? (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.inputLabel}>
                {t('auto.mobile.src.auth.MobileSmsLoginForm.3ef28ec077', 'Verification code')}
              </Text>
              <TextInput
                accessibilityLabel={t(
                  'auto.mobile.src.auth.MobileSmsLoginForm.c7427b3cb0',
                  'SMS verification code'
                )}
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={6}
                onBlur={() => setFocused(null)}
                onChangeText={(value) => setSmsCode(value.replace(/\D/g, '').slice(0, 6))}
                onFocus={() => setFocused('code')}
                placeholder={t(
                  'auto.mobile.src.auth.MobileSmsLoginForm.ce517ab65d',
                  'Enter the 6-digit verification code'
                )}
                placeholderTextColor={theme.color.text.tertiary}
                style={inputStyle('code')}
                value={smsCode}
              />
              <Pressable
                accessibilityLabel={t(
                  'auto.mobile.src.auth.MobileSmsLoginForm.e02fef04f5',
                  'Confirm sign-in'
                )}
                accessibilityRole="button"
                accessibilityState={{ busy, disabled: !canLogin }}
                disabled={!canLogin}
                onPress={() => void submit()}
                style={({ pressed }) => [
                  styles.action,
                  pressed && styles.pressed,
                  !canLogin && styles.actionDisabled
                ]}
              >
                {busy && challengeId ? (
                  <ActivityIndicator color={theme.color.text.inverse} />
                ) : (
                  <Text style={styles.actionLabel}>
                    {t('auto.mobile.src.auth.MobileSmsLoginForm.0332991359', 'Sign in')}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={1.3} style={styles.helper}>
            {t(
              'auto.mobile.src.auth.MobileSmsLoginForm.0865c6b4d6',
              'The verification code is used for this sign-in only and is not saved to this device.'
            )}
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
