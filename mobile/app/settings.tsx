import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Bell,
  ChevronLeft,
  Database,
  Globe,
  Info,
  KeyRound,
  Languages,
  LifeBuoy,
  LogIn,
  MessageSquare,
  Mic,
  MonitorDown,
  MonitorSmartphone,
  Palette,
  RefreshCw,
  Scale,
  Shield,
  Terminal as TerminalIcon,
  UserRound,
  Wrench
} from 'lucide-react-native'
import { APP_DISPLAY_NAME, PRODUCT_PUBLIC_LINKS, productNameText } from '@/product-brand'
import { useMobileTheme, useMobileThemePreference } from '../src/theme/mobile-theme-provider'
import type { MobileThemePreference } from '../src/theme/mobile-theme-preference'
import { SettingsGroup, SettingsRow } from '../src/settings/SettingsGroup'
import { createSettingsScreenStyles } from '../src/settings/settings-screen-styles'
import {
  loadPendingHostCredentialCleanup,
  subscribePendingHostCredentialCleanup
} from '../src/transport/host-credential-cleanup'
import { retryPendingHostCredentialCleanup } from '../src/transport/host-store'
import { useMobileAuthSession } from '../src/auth/mobile-auth-session'
import { useMobileUpdate } from '../src/update/use-mobile-update'

const THEME_OPTIONS: readonly { label: string; value: MobileThemePreference }[] = [
  { label: '系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' }
]

export default function SettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const { hydrated: authHydrated, session } = useMobileAuthSession()
  const { snapshot: mobileUpdate, checkNow, install } = useMobileUpdate(false)
  const {
    preference,
    hydrated: themePreferenceHydrated,
    setPreference
  } = useMobileThemePreference()
  const styles = useMemo(() => createSettingsScreenStyles(theme), [theme])
  const [pendingCredentialIds, setPendingCredentialIds] = useState<string[]>([])
  const [credentialStorageUnreadable, setCredentialStorageUnreadable] = useState(false)
  const [retryingCredentialCleanup, setRetryingCredentialCleanup] = useState(false)
  const [credentialRetryFailed, setCredentialRetryFailed] = useState(false)
  const [themePreferenceSaveFailed, setThemePreferenceSaveFailed] = useState(false)
  const credentialRefreshGenerationRef = useRef(0)

  useFocusEffect(
    useCallback(() => {
      let active = true
      setCredentialRetryFailed(false)
      const refresh = () => {
        const generation = ++credentialRefreshGenerationRef.current
        void loadPendingHostCredentialCleanup().then((state) => {
          if (active && generation === credentialRefreshGenerationRef.current) {
            setPendingCredentialIds(state.ids)
            setCredentialStorageUnreadable(state.storageUnreadable)
            if (state.ids.length === 0 && !state.storageUnreadable) {
              setCredentialRetryFailed(false)
            }
          }
        })
      }
      const unsubscribe = subscribePendingHostCredentialCleanup(refresh)
      refresh()
      return () => {
        active = false
        credentialRefreshGenerationRef.current += 1
        unsubscribe()
      }
    }, [])
  )

  const retryCredentialCleanup = useCallback(async () => {
    if (retryingCredentialCleanup) {
      return
    }
    setCredentialRetryFailed(false)
    setRetryingCredentialCleanup(true)
    try {
      const result = await retryPendingHostCredentialCleanup()
      setPendingCredentialIds(result.remainingIds)
      setCredentialStorageUnreadable(result.storageUnreadable)
      setCredentialRetryFailed(result.remainingIds.length > 0 || result.storageUnreadable)
    } catch {
      setCredentialRetryFailed(true)
    } finally {
      setRetryingCredentialCleanup(false)
    }
  }, [retryingCredentialCleanup])

  const goBack = () => {
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/')
  }

  const pendingCredentialCount = pendingCredentialIds.length
  const showCredentialCleanup = pendingCredentialCount > 0 || credentialStorageUnreadable

  const changeThemePreference = useCallback(
    async (nextPreference: MobileThemePreference) => {
      setThemePreferenceSaveFailed(false)
      const saved = await setPreference(nextPreference)
      setThemePreferenceSaveFailed(!saved)
    },
    [setPreference]
  )

  const checkAndInstallUpdate = useCallback(async () => {
    const result = await checkNow()
    if (result.state === 'available') {
      await install()
    }
  }, [checkNow, install])

  const updateLabel =
    mobileUpdate.state === 'checking'
      ? '检查中'
      : mobileUpdate.state === 'available' || mobileUpdate.state === 'downloading'
        ? `有更新 ${mobileUpdate.version ?? ''}`.trim()
        : mobileUpdate.state === 'error'
          ? '检查失败，点击重试'
          : '已是最新版本'

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={4}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          onPress={goBack}
        >
          <ChevronLeft size={24} strokeWidth={1.8} color={theme.color.text.primary} />
        </Pressable>
        <Text style={[theme.typography.pageTitle, { color: theme.color.text.primary }]}>设置</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + theme.spacing.space32 }
        ]}
      >
        <SettingsGroup title="账号">
          <SettingsRow
            icon={UserRound}
            label={`${APP_DISPLAY_NAME} 账号`}
            value={!authHydrated ? '读取中' : session ? session.account.displayName : '未登录'}
            onPress={() => router.push('/account')}
          />
          <SettingsRow
            icon={LogIn}
            label="登录与注册"
            value={session ? '已登录' : '登录/注册'}
            onPress={() => router.push('/login')}
          />
          <SettingsRow
            disabled={!session}
            icon={MonitorSmartphone}
            label="Runtime 会话"
            last
            value={session ? '查看与撤销' : '登录后可用'}
            onPress={session ? () => router.push('/runtime-sessions') : undefined}
          />
        </SettingsGroup>

        <SettingsGroup title="显示与语言">
          <View style={styles.appearanceRow}>
            <Palette size={20} strokeWidth={1.8} color={theme.color.text.secondary} />
            <View style={styles.appearanceContent}>
              <Text style={[theme.typography.body, { color: theme.color.text.primary }]}>外观</Text>
              <View accessibilityLabel="外观主题" style={styles.themeOptions}>
                {THEME_OPTIONS.map((option) => {
                  const selected = option.value === preference
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{
                        checked: selected,
                        disabled: !themePreferenceHydrated
                      }}
                      disabled={!themePreferenceHydrated}
                      key={option.value}
                      onPress={() => void changeThemePreference(option.value)}
                      style={({ pressed }) => [
                        styles.themeOption,
                        selected && styles.themeOptionSelected,
                        pressed && styles.themeOptionPressed
                      ]}
                    >
                      <Text
                        style={[
                          theme.typography.caption,
                          styles.themeOptionText,
                          selected && styles.themeOptionTextSelected
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              {themePreferenceSaveFailed ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[theme.typography.caption, { color: theme.color.status.warningText }]}
                >
                  主题已临时切换，但未能保存到此设备。
                </Text>
              ) : null}
            </View>
          </View>
          <SettingsRow last disabled icon={Languages} label="语言" value="简体中文 · 后续支持" />
        </SettingsGroup>

        <SettingsGroup title="客户端">
          <SettingsRow
            icon={TerminalIcon}
            label="终端"
            onPress={() => router.push('/terminal-settings')}
          />
          <SettingsRow
            icon={MessageSquare}
            label="聊天界面"
            onPress={() => router.push('/native-chat-settings')}
          />
          <SettingsRow
            icon={Globe}
            label="浏览器"
            onPress={() => router.push('/browser-settings')}
          />
          <SettingsRow icon={Mic} label="语音" onPress={() => router.push('/voice-settings')} />
          <SettingsRow
            last
            icon={Bell}
            label="通知"
            onPress={() => router.push('/notifications')}
          />
        </SettingsGroup>

        <SettingsGroup title="支持与诊断">
          <SettingsRow
            icon={Wrench}
            label="故障排查"
            onPress={() => router.push('/troubleshoot')}
          />
          <SettingsRow
            last={!PRODUCT_PUBLIC_LINKS.support}
            icon={LifeBuoy}
            label="帮助与反馈"
            onPress={() => router.push('/feedback')}
          />
          {PRODUCT_PUBLIC_LINKS.support ? (
            <SettingsRow
              last
              icon={Globe}
              label="在线帮助"
              onPress={() => void Linking.openURL(PRODUCT_PUBLIC_LINKS.support!)}
            />
          ) : null}
        </SettingsGroup>

        <SettingsGroup title="法律与隐私">
          <SettingsRow icon={Shield} label="隐私中心" onPress={() => router.push('/privacy')} />
          <SettingsRow
            icon={Scale}
            label="服务协议"
            value={PRODUCT_PUBLIC_LINKS.termsOfService ? '已配置' : '尚未配置'}
            onPress={() => router.push({ pathname: '/legal', params: { document: 'terms' } })}
          />
          <SettingsRow
            last
            icon={Shield}
            label="隐私政策"
            value={PRODUCT_PUBLIC_LINKS.privacyPolicy ? '已配置' : '尚未配置'}
            onPress={() => router.push({ pathname: '/legal', params: { document: 'privacy' } })}
          />
        </SettingsGroup>

        <SettingsGroup title="存储与关于">
          <SettingsRow icon={Database} label="存储空间" onPress={() => router.push('/storage')} />
          <SettingsRow disabled icon={MonitorDown} label="桌面客户端下载" value="尚未配置" />
          <SettingsRow
            icon={RefreshCw}
            label="检查更新"
            value={updateLabel}
            disabled={mobileUpdate.state === 'checking' || mobileUpdate.state === 'downloading'}
            onPress={() => void checkAndInstallUpdate()}
          />
          <SettingsRow
            last
            icon={Info}
            label={productNameText('关于 HiveCode')}
            onPress={() => router.push('/about')}
          />
        </SettingsGroup>

        {showCredentialCleanup ? (
          <SettingsGroup title="安全恢复">
            <View style={styles.credentialRow}>
              <KeyRound size={20} strokeWidth={1.8} color={theme.color.status.warning} />
              <View style={styles.credentialCopy}>
                <Text style={[theme.typography.body, { color: theme.color.text.primary }]}>
                  配对凭据清理
                </Text>
                <Text
                  accessibilityLiveRegion="polite"
                  style={[theme.typography.caption, { color: theme.color.text.secondary }]}
                >
                  {credentialRetryFailed
                    ? '仍无法确认清理结果，请稍后重试。'
                    : pendingCredentialCount > 0
                      ? `此设备仍有 ${pendingCredentialCount} 个凭据未确认清理。`
                      : '无法读取凭据清理状态，请重试确认。'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Retry clearing pairing credentials"
                accessibilityState={{
                  busy: retryingCredentialCleanup,
                  disabled: retryingCredentialCleanup
                }}
                disabled={retryingCredentialCleanup}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && !retryingCredentialCleanup && styles.pressed
                ]}
                onPress={() => void retryCredentialCleanup()}
              >
                {retryingCredentialCleanup ? (
                  <ActivityIndicator size="small" color={theme.color.text.secondary} />
                ) : (
                  <Text style={[theme.typography.label, { color: theme.color.text.primary }]}>
                    重试
                  </Text>
                )}
              </Pressable>
            </View>
          </SettingsGroup>
        ) : null}
      </ScrollView>
    </View>
  )
}
