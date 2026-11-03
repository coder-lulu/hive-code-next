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
            accessibilityLabel="返回"
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          >
            <ArrowLeft size={24} strokeWidth={2} color={theme.color.text.primary} />
          </Pressable>
          <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
            认领电脑
          </Text>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.content, isWideLayout && { maxWidth: contentMaxWidth }]}
        >
          {!hydrated ? (
            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
              正在读取账号…
            </Text>
          ) : session ? (
            <SignedInClaimForm
              key={`${session.authorityId}:${session.account.accountId}`}
              session={session}
            />
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                请登录电脑端使用的同一 HiveCloud 账号，再输入认领码确认电脑。
              </Text>
              <ClaimAction onPress={() => router.push('/login')}>登录 HiveCloud</ClaimAction>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SignedInClaimForm({ session }: { session: MobileSession }) {
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
          认领已确认
        </Text>
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
          请返回电脑端完成绑定。完成后，电脑会同步到此账号的首页和设备列表。
        </Text>
        <ClaimAction onPress={viewComputers}>查看我的电脑</ClaimAction>
      </View>
    )
  }
  return (
    <View style={styles.form}>
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        在电脑端的连接设置中登录同一 HiveCloud 账号，发起设备认领，再输入电脑端显示的认领码。
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
        当前账号：{session.account.displayName}
      </Text>
      {!claim.preview ? (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            认领码
          </Text>
          <TextInput
            accessibilityLabel="电脑认领码"
            placeholder="ABCD-EFGH"
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
            {claim.busy ? '正在核对…' : '查看待认领电脑'}
          </ClaimAction>
        </>
      ) : (
        <>
          <View style={styles.details}>
            <Text maxFontSizeMultiplier={1.3} style={styles.label}>
              请核对，这是你发起认领的电脑
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.value}>
              认领码：{claim.code}
            </Text>
            <Text selectable maxFontSizeMultiplier={1.3} style={styles.hint}>
              电脑标识：{claim.preview.runtimeRecordId}
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
              HiveCode 版本：{claim.preview.runtimeVersion}
            </Text>
          </View>
          {claim.sms ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
                style={styles.body}
              >
                验证码已发送至 {claim.sms.phoneNumberMasked}
              </Text>
              <TextInput
                accessibilityLabel="认领短信验证码"
                placeholder="六位验证码"
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
                {claim.busy ? '正在确认…' : '验证并确认认领'}
              </ClaimAction>
            </>
          ) : null}
          <ClaimAction
            secondary={!!claim.sms}
            disabled={claim.unavailable || claim.resendRemaining > 0}
            onPress={() => void claim.sendSms()}
          >
            {claim.resendRemaining > 0
              ? `${claim.resendRemaining} 秒后可重新发送`
              : claim.sms
                ? '重新发送验证码'
                : '发送验证码到绑定手机号'}
          </ClaimAction>
          <ClaimAction secondary disabled={claim.busy || claim.uncertain} onPress={claim.reset}>
            重新输入认领码
          </ClaimAction>
        </>
      )}
      {claim.expired ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          认领请求已过期，请在电脑端重新发起。
        </Text>
      ) : null}
      {claim.smsExpired && !claim.expired ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          验证码已过期，请重新发送。
        </Text>
      ) : null}
      {claim.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {claim.error}
        </Text>
      ) : null}
      {claim.requiresLogin ? (
        <ClaimAction onPress={() => router.push('/login')}>重新登录</ClaimAction>
      ) : null}
      {claim.uncertain ? (
        <ClaimAction secondary onPress={viewComputers}>
          查看我的电脑
        </ClaimAction>
      ) : null}
      <Text maxFontSizeMultiplier={1.3} style={styles.hint}>
        认领只授予此账号的云端访问权限，连接状态以电脑是否在线为准。
      </Text>
    </View>
  )
}
