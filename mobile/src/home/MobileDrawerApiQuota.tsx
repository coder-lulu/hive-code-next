import { Coins, ChevronRight, RefreshCw } from 'lucide-react-native'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { formatAiInteger } from '../../../src/shared/hive-ai-account'
import { useMobileAiAccount } from '../ai-account/use-mobile-ai-account'
import type { MobileTheme } from '../theme/mobile-theme'

export function MobileDrawerApiQuota({
  theme,
  onOpen
}: {
  readonly theme: MobileTheme
  readonly onOpen: () => void
}) {
  const state = useMobileAiAccount()
  const balance = state.snapshot?.balance
  const status = state.snapshot?.account.status
  const available =
    status === 'ACTIVE' &&
    balance?.accountStatus === 'ACTIVE' &&
    balance.freshness === 'CURRENT' &&
    balance.availableQuota !== null
  const label = !state.hydrated
    ? '获取中…'
    : !state.signedIn
      ? '登录后查看'
      : state.loading
        ? '获取中…'
        : state.failed
          ? '暂时不可用'
          : status === 'NOT_PROVISIONED'
            ? '未激活'
            : status === 'PENDING'
              ? '准备中…'
              : status === 'DISABLED'
                ? '已停用'
                : available
                  ? `${formatAiInteger(balance.availableQuota, 'zh-CN')} 积分`
                  : '暂时不可用'
  const styles = createStyles(theme)
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`API 额度，${label}`}
        onPress={onOpen}
        style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
      >
        <Coins size={24} strokeWidth={2} color={theme.color.text.primary} />
        <View style={styles.copy}>
          <Text maxFontSizeMultiplier={1.3} style={styles.title}>
            API 额度
          </Text>
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={1.3} style={styles.value}>
            {label}
          </Text>
        </View>
        <ChevronRight size={20} strokeWidth={2} color={theme.color.text.tertiary} />
      </Pressable>
      {state.hydrated && state.signedIn && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新 API 额度"
          accessibilityState={{ disabled: state.loading, busy: state.loading }}
          disabled={state.loading}
          onPress={() => void state.refresh()}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}
        >
          {state.loading ? (
            <ActivityIndicator color={theme.color.text.secondary} />
          ) : (
            <RefreshCw size={20} strokeWidth={2} color={theme.color.text.secondary} />
          )}
        </Pressable>
      )}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center' },
    entry: {
      minWidth: 0,
      flex: 1,
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space12,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.card
    },
    copy: { minWidth: 0, flex: 1 },
    title: { ...theme.typography.body, fontWeight: '500', color: theme.color.text.primary },
    value: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4,
      fontVariant: ['tabular-nums']
    },
    refresh: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: theme.radii.control
    },
    pressed: { backgroundColor: theme.color.bg.subtle }
  })
}
