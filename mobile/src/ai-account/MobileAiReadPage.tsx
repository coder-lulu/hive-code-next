import { hostOs } from '../platform/host-os'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { useMobileTheme } from '../theme/mobile-theme-provider'
import { createSettingsScreenStyles } from '../settings/settings-screen-styles'

type Props = {
  title: string
  description: string
  refreshLabel: string
  signedOutMessage: string
  loadingMessage: string
  errorMessage: string
  message?: string
  hydrated: boolean
  signedIn: boolean
  loading: boolean
  failed: boolean
  refresh: () => Promise<void>
  action?: { label: string; onPress: () => void; busy: boolean; disabled: boolean }
  children: ReactNode
}

export function MobileAiReadPage(props: Props) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const theme = useMobileTheme()
  const styles = useMemo(() => createSettingsScreenStyles(theme), [theme])
  const [showLoading, setShowLoading] = useState(false)
  const [focusedAction, setFocusedAction] = useState<string | null>(null)
  useEffect(() => {
    setShowLoading(false)
    if (!props.loading) {
      return
    }
    const timer = setTimeout(() => setShowLoading(true), 300)
    return () => clearTimeout(timer)
  }, [props.loading])
  const message = !props.hydrated
    ? '正在读取登录状态'
    : !props.signedIn
      ? props.signedOutMessage
      : props.action?.busy && showLoading
        ? '正在处理开通请求…'
        : props.message
          ? props.message
          : props.loading
            ? showLoading
              ? props.loadingMessage
              : ''
            : props.failed
              ? props.errorMessage
              : ''
  const buttonStyle = {
    minWidth: theme.size.minimumTouchTarget,
    minHeight: theme.size.minimumTouchTarget,
    paddingHorizontal: theme.spacing.space12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderRadius: theme.radii.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border.default
  }
  const button = (
    label: string,
    onPress: () => void,
    disabled = false,
    text = props.signedIn ? '刷新' : '登录或注册',
    primary = false,
    busy = disabled
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocusedAction(label)}
      onBlur={() => setFocusedAction(null)}
      style={({ pressed }) => [
        buttonStyle,
        pressed && primary && !disabled && styles.themeOptionPressed,
        {
          backgroundColor: disabled
            ? theme.color.bg.subtle
            : primary
              ? theme.color.bg.selected
              : pressed
                ? theme.color.bg.subtle
                : theme.color.bg.surface,
          borderColor:
            focusedAction === label ? theme.color.brand.primary : theme.color.border.default
        }
      ]}
    >
      <Text
        style={[
          theme.typography.label,
          {
            color: disabled
              ? theme.color.text.secondary
              : primary
                ? theme.color.text.inverse
                : theme.color.text.primary
          }
        ]}
      >
        {text}
      </Text>
    </Pressable>
  )
  return (
    <KeyboardAvoidingView
      behavior={hostOs() === 'ios' ? 'padding' : undefined}
      style={[styles.screen, { paddingTop: insets.top }]}
    >
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onFocus={() => setFocusedAction('返回')}
          onBlur={() => setFocusedAction(null)}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
            focusedAction === '返回' && {
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.color.brand.primary
            }
          ]}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
        >
          <ChevronLeft
            size={theme.spacing.space24}
            strokeWidth={2}
            color={theme.color.text.primary}
          />
        </Pressable>
        <Text
          accessibilityRole="header"
          style={[theme.typography.pageTitle, { color: theme.color.text.primary, flexShrink: 1 }]}
        >
          {props.title}
        </Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + theme.spacing.space32
          }
        ]}
      >
        <Text style={[theme.typography.meta, { color: theme.color.text.secondary }]}>
          {props.description}
        </Text>
        {props.hydrated && props.signedIn && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.space8 }}>
            {props.action &&
              button(
                props.action.label,
                props.action.onPress,
                props.action.disabled,
                props.action.label,
                true,
                props.action.busy
              )}
            {button(props.refreshLabel, () => void props.refresh(), props.loading)}
          </View>
        )}
        <View accessibilityLiveRegion="polite">
          {message ? (
            <Text style={[theme.typography.body, { color: theme.color.text.secondary }]}>
              {message}
            </Text>
          ) : null}
          {props.hydrated && props.signedIn && props.children}
        </View>
        {props.hydrated && !props.signedIn && button('登录或注册', () => router.push('/login'))}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
