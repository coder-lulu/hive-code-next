import { Pressable, Text, View } from 'react-native'
import { ChevronLeft, ExternalLink, RefreshCw, X } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileSourceControlStyles } from './mobile-source-control-styles'

type Props = {
  embedded: boolean
  worktreeLabel: string
  ioBusy: boolean
  onBack: () => void
  onRefresh: () => void
  // When set (PR segment ready with a host URL), show open-on-web flush-right of
  // the title so the control stays visible while the PR body scrolls.
  onOpenPrWeb?: () => void
  prNumber?: number | null
}

export function MobileSourceControlHeader({
  embedded,
  worktreeLabel,
  ioBusy,
  onBack,
  onRefresh,
  onOpenPrWeb,
  prNumber = null
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileSourceControlStyles)
  return (
    <View style={styles.topBar}>
      <Pressable
        style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        onPress={onBack}
        hitSlop={8}
        accessibilityLabel={embedded ? '关闭源码控制' : '返回会话'}
      >
        {embedded ? (
          <X size={20} color={theme.color.text.secondary} strokeWidth={2} />
        ) : (
          <ChevronLeft size={20} color={theme.color.text.secondary} strokeWidth={2} />
        )}
      </Pressable>
      <View style={styles.titleBlock}>
        <Text style={styles.title} numberOfLines={1}>
          源码控制
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {worktreeLabel}
        </Text>
      </View>
      {onOpenPrWeb ? (
        <Pressable
          style={({ pressed }) => [styles.refreshButton, pressed && styles.refreshButtonPressed]}
          onPress={onOpenPrWeb}
          hitSlop={8}
          accessibilityRole="link"
          accessibilityLabel={
            prNumber != null ? `在网页中打开拉取请求 #${prNumber}` : '在网页中打开拉取请求'
          }
        >
          <ExternalLink size={20} color={theme.color.text.secondary} strokeWidth={2} />
        </Pressable>
      ) : null}
      <Pressable
        style={({ pressed }) => [
          styles.refreshButton,
          ioBusy && styles.refreshButtonDisabled,
          pressed && styles.refreshButtonPressed
        ]}
        onPress={onRefresh}
        disabled={ioBusy}
        hitSlop={8}
        accessibilityLabel="刷新源码控制"
      >
        <RefreshCw size={20} color={theme.color.text.secondary} strokeWidth={2} />
      </Pressable>
    </View>
  )
}
