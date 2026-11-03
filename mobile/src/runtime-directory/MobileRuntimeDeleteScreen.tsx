import { useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { z } from 'zod'
import { useMobileAuthSession } from '../auth/mobile-auth-session'
import type { MobileSession } from '../auth/mobile-sms-auth'
import { PairingActionButton } from '../components/pairing/PairingActionButton'
import { MobileIconButton } from '../components/ui/MobileIconButton'
import { MobileScreenHeader } from '../components/ui/MobileScreenHeader'
import { useResponsiveLayout } from '../layout/responsive-layout'
import { hostOs } from '../platform/host-os'
import { useKeyboardOcclusion } from '../platform/keyboard-occlusion'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileRuntimeClaimStyles } from './mobile-runtime-claim-styles'
import { runtimeDeleteConfirmationName } from './mobile-runtime-delete-state'
import { useMobileRuntimeDelete } from './use-mobile-runtime-delete'

const RuntimeIdSchema = z.uuid().refine((value) => value === value.toLowerCase())

export function MobileRuntimeDeleteScreen() {
  const router = useRouter()
  const { runtimeRecordId } = useLocalSearchParams<{ runtimeRecordId?: string | string[] }>()
  const target = RuntimeIdSchema.safeParse(runtimeRecordId)
  const { hydrated, session } = useMobileAuthSession()
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const { isWideLayout, contentMaxWidth } = useResponsiveLayout()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardOcclusion()
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.screen}>
      <MobileScreenHeader
        title="删除 Runtime"
        leading={
          <MobileIconButton
            accessibilityLabel="返回"
            icon={ArrowLeft}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          />
        }
      />
      <KeyboardAvoidingView
        behavior={hostOs() === 'ios' ? 'padding' : undefined}
        style={[
          styles.viewport,
          hostOs() === 'android' && { marginBottom: Math.max(0, keyboardHeight - insets.bottom) }
        ]}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[styles.content, isWideLayout && { maxWidth: contentMaxWidth }]}
        >
          {!target.success ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
              Runtime 标识无效，请返回列表重新选择。
            </Text>
          ) : !hydrated ? (
            <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
              正在读取账号…
            </Text>
          ) : session ? (
            <SignedInDeleteForm
              key={`${session.authorityId}:${session.account.accountId}:${session.sessionExpiresAt}:${target.data}`}
              runtimeRecordId={target.data}
              session={session}
            />
          ) : (
            <>
              <Text maxFontSizeMultiplier={1.3} style={styles.body}>
                请登录认领这台 Runtime 的 HiveCloud 账号。
              </Text>
              <PairingActionButton label="登录 HiveCloud" onPress={() => router.push('/login')} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function SignedInDeleteForm({
  runtimeRecordId,
  session
}: {
  runtimeRecordId: string
  session: MobileSession
}) {
  const router = useRouter()
  const deletion = useMobileRuntimeDelete(runtimeRecordId, session)
  const styles = useMobileThemeStyles(createMobileRuntimeClaimStyles)
  const theme = useMobileTheme()
  const [focused, setFocused] = useState<'name' | 'sms' | null>(null)
  const unavailable = deletion.busy || deletion.loading || deletion.requiresLogin
  if (deletion.unsupported) {
    return (
      <Text maxFontSizeMultiplier={1.3} style={styles.body}>
        请在手机 APP 中删除 Runtime 并清理连接记录。
      </Text>
    )
  }
  return (
    <View style={styles.form}>
      {deletion.completed ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.value}>
            {deletion.superseded
              ? '此 Runtime 的认领或删除操作已更新，已保留当前连接。请返回列表查看最新状态。'
              : 'Runtime 已从账号解除认领，本机连接记录已清理。电脑上的项目和会话数据仍保留。'}
          </Text>
          <PairingActionButton label="返回首页" onPress={() => router.replace('/')} />
        </>
      ) : deletion.cloudConfirmed ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
            已从账号解除认领，正在清理这台手机的连接记录。若清理失败，可以重试，无需再次验证短信。
          </Text>
          <PairingActionButton
            label="重试清理本机记录"
            loading={deletion.busy}
            disabled={unavailable}
            onPress={() => void deletion.retryCleanup()}
          />
        </>
      ) : deletion.uncertain ? (
        <>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
            暂时无法确认删除结果。请先核对账号中的 Runtime 状态，再继续操作。
          </Text>
          <PairingActionButton
            label="核对删除结果"
            loading={deletion.busy}
            disabled={unavailable}
            onPress={() => void deletion.review()}
          />
        </>
      ) : deletion.loading ? (
        <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.body}>
          正在核对 Runtime 归属…
        </Text>
      ) : deletion.entry ? (
        <>
          <View style={styles.details}>
            <Text maxFontSizeMultiplier={1.3} style={styles.value}>
              {runtimeDeleteConfirmationName(deletion.entry)}
            </Text>
            <Text selectable maxFontSizeMultiplier={1.3} style={styles.hint}>
              {runtimeRecordId}
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            删除后，这台 Runtime
            将从账号解除认领，已有连接授权将被撤销，并清理这台手机上与它关联的全部连接记录。电脑离线时也可以操作。
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            电脑上的项目和会话数据会保留。重新使用需要再次认领或配对。
          </Text>
          <Text maxFontSizeMultiplier={1.3} style={styles.label}>
            请输入上方完整名称以确认
          </Text>
          <TextInput
            accessibilityLabel="确认 Runtime 名称"
            value={deletion.confirmationName}
            onChangeText={deletion.setConfirmationName}
            editable={!unavailable}
            autoCapitalize="none"
            autoCorrect={false}
            maxFontSizeMultiplier={1.3}
            onFocus={() => setFocused('name')}
            onBlur={() => setFocused(null)}
            style={[styles.input, focused === 'name' && styles.focused]}
          />
          {deletion.sms ? (
            <>
              <Text
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={1.3}
                style={styles.hint}
              >
                验证码已发送至 {deletion.sms.phoneNumberMasked}
              </Text>
              <TextInput
                accessibilityLabel="删除 Runtime 短信验证码"
                placeholder="六位验证码"
                placeholderTextColor={theme.color.text.tertiary}
                value={deletion.smsCode}
                onChangeText={deletion.setSmsCode}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                maxFontSizeMultiplier={1.3}
                editable={!unavailable && !deletion.smsExpired}
                onFocus={() => setFocused('sms')}
                onBlur={() => setFocused(null)}
                style={[styles.input, focused === 'sms' && styles.focused]}
              />
            </>
          ) : null}
          {deletion.smsExpired ? (
            <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
              验证码已过期，请重新发送。
            </Text>
          ) : null}
          <PairingActionButton
            variant="secondary"
            label={
              deletion.smsDailyLimited
                ? '今日短信次数已用完'
                : deletion.resendRemaining > 0
                  ? `${deletion.resendRemaining} 秒后可重新发送`
                  : deletion.sms
                    ? '重新发送验证码'
                    : '发送验证码到绑定手机号'
            }
            labelStyle={{ flexShrink: 1, textAlign: 'center' }}
            disabled={unavailable || deletion.smsDailyLimited || deletion.resendRemaining > 0}
            onPress={() => void deletion.sendSms()}
          />
          <PairingActionButton
            label={deletion.busy ? '正在处理…' : '验证并删除 Runtime'}
            variant="secondary"
            labelStyle={styles.error}
            disabled={!deletion.canSubmit}
            onPress={() => void deletion.confirm()}
          />
        </>
      ) : (
        <>
          <Text maxFontSizeMultiplier={1.3} style={styles.body}>
            当前没有可删除的 Runtime，请重新核对账号中的设备。
          </Text>
          <PairingActionButton
            label="重新核对"
            disabled={unavailable}
            onPress={() => void deletion.review()}
          />
        </>
      )}
      {deletion.error ? (
        <Text accessibilityRole="alert" maxFontSizeMultiplier={1.3} style={styles.error}>
          {deletion.error}
        </Text>
      ) : null}
      {deletion.requiresLogin ? (
        <PairingActionButton label="重新登录" onPress={() => router.push('/login')} />
      ) : null}
    </View>
  )
}
