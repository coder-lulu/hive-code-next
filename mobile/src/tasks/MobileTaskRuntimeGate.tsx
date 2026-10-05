import { ListTodo, RefreshCw } from 'lucide-react-native'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { productNameText } from '@/product-brand'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileTaskScreenStyles } from './mobile-task-screen-styles'
import type { MobileTaskRuntimeState } from './mobile-task-runtime-state'

export function MobileTaskRuntimeGate(props: {
  readonly onRetry?: () => void
  readonly onSelectRuntime: () => void
  readonly state: MobileTaskRuntimeState
}) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileTaskScreenStyles)

  if (props.state === 'loading' || props.state === 'ready') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="small" color={theme.color.text.secondary} />
      </View>
    )
  }

  if (props.state === 'unsupported') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>{productNameText('请更新 Orca 桌面端')}</Text>
        <Text style={styles.centeredHint}>
          当前移动端任务中心需要新版桌面运行时，更新后即可继续使用现有任务功能。
        </Text>
      </View>
    )
  }

  const authenticationFailed = props.state === 'auth-failed'
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <ListTodo color={theme.color.text.secondary} size={32} strokeWidth={1.7} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
        {authenticationFailed ? 'Runtime 配对已失效' : 'Runtime 当前离线'}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.emptyDescription}>
        {authenticationFailed
          ? '任务状态不可验证。请先重试连接，若仍失败，请重新配对这台电脑。'
          : '任务状态不可验证。Runtime 恢复在线后即可继续。'}
      </Text>
      {props.onRetry ? (
        <Pressable
          accessibilityLabel="重试连接 Runtime"
          accessibilityRole="button"
          onPress={props.onRetry}
          style={({ pressed }) => [
            styles.emptyPrimaryButton,
            pressed && styles.emptyPrimaryButtonPressed
          ]}
        >
          <RefreshCw color={theme.color.text.inverse} size={20} strokeWidth={2} />
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyPrimaryButtonText}>
            重试连接
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={props.onSelectRuntime}
        style={styles.emptySecondaryButton}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.emptySecondaryButtonText}>
          连接或切换电脑
        </Text>
      </Pressable>
    </View>
  )
}
