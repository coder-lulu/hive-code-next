import { ArrowLeft } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
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

type MobileSmsLoginFormProps = {
  readonly onClose: () => void
  readonly onSuccess: (session: MobileSession) => void | Promise<void>
  readonly termsAccepted: boolean
}

export function MobileSmsLoginForm({ onClose, onSuccess, termsAccepted }: MobileSmsLoginFormProps) {
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
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <Pressable
        accessibilityLabel="关闭手机号登录"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.backdrop}
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.spacing.space24 }]}>
        <View style={styles.topRow}>
          <Pressable
            accessibilityLabel="返回登录方式"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <ArrowLeft color={theme.color.text.primary} size={20} strokeWidth={1.9} />
          </Pressable>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
            手机号登录/注册
          </Text>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text maxFontSizeMultiplier={1.3} style={styles.subtitle}>
            验证成功后自动登录；首次验证将自动注册新账号。
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.inputLabel}>
            手机号
          </Text>
          <TextInput
            accessibilityLabel="手机号"
            autoComplete="tel"
            autoCorrect={false}
            keyboardType="phone-pad"
            maxLength={11}
            onBlur={() => setFocused(null)}
            onChangeText={(value) => setPhoneNumber(value.replace(/\D/g, '').slice(0, 11))}
            onFocus={() => setFocused('phone')}
            placeholder="请输入 11 位手机号"
            placeholderTextColor={theme.color.text.tertiary}
            style={inputStyle('phone')}
            value={phoneNumber}
          />
          <Pressable
            accessibilityLabel={countdown > 0 ? `验证码倒计时 ${countdown} 秒` : '发送验证码'}
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
                    ? `${countdown}s 后重新发送`
                    : '重新发送验证码'
                  : '发送验证码'}
              </Text>
            )}
          </Pressable>
          {challengeId ? (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.inputLabel}>
                验证码
              </Text>
              <TextInput
                accessibilityLabel="短信验证码"
                autoComplete="one-time-code"
                keyboardType="number-pad"
                maxLength={6}
                onBlur={() => setFocused(null)}
                onChangeText={(value) => setSmsCode(value.replace(/\D/g, '').slice(0, 6))}
                onFocus={() => setFocused('code')}
                placeholder="请输入 6 位验证码"
                placeholderTextColor={theme.color.text.tertiary}
                style={inputStyle('code')}
                value={smsCode}
              />
              <Pressable
                accessibilityLabel="确认登录"
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
                  <Text style={styles.actionLabel}>登录</Text>
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
            验证码仅用于本次登录，不会保存到设备。
          </Text>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}
