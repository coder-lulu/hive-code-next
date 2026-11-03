import { useMobileTranslation } from '../i18n/use-mobile-translation'
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
  const t = useMobileTranslation()

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
          {t(
            'auto.mobile.src.tasks.MobileTaskRuntimeGate.6d692ebfd4',
            'The mobile task center requires a newer desktop runtime. Update it to keep using your existing tasks.'
          )}
        </Text>
      </View>
    )
  }

  const messages = {
    'auth-failed': {
      title: t(
        'auto.mobile.src.tasks.MobileTaskRuntimeGate.a989c9e249',
        'Runtime connection verification failed'
      ),
      description: t(
        'auto.mobile.src.tasks.MobileTaskRuntimeGate.1296853184',
        'Task status cannot be verified. Retry the connection first. If it still fails, check your sign-in status or pair this computer again.'
      )
    },
    offline: {
      title: t('auto.mobile.src.tasks.MobileTaskRuntimeGate.5d013de644', 'Runtime is offline'),
      description: productNameText('任务状态不可验证。请确认电脑上的 Orca 正在运行，再重试连接。')
    },
    disconnected: {
      title: t('auto.mobile.src.tasks.MobileTaskRuntimeGate.9b3b65d7f6', 'No Runtime connected'),
      description: t(
        'auto.mobile.src.tasks.MobileTaskRuntimeGate.895f54574f',
        'Task status cannot be verified. Retry the connection to continue.'
      )
    },
    unavailable: {
      title: t(
        'auto.mobile.src.tasks.MobileTaskRuntimeGate.281f270041',
        'Runtime connection is temporarily unavailable'
      ),
      description: productNameText('任务状态不可验证。请检查电脑上的 Orca 连接状态，稍后重试。')
    }
  }[props.state]
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <ListTodo color={theme.color.text.secondary} size={32} strokeWidth={1.7} />
      </View>
      <Text maxFontSizeMultiplier={1.3} style={styles.emptyTitle}>
        {messages.title}
      </Text>
      <Text maxFontSizeMultiplier={1.3} style={styles.emptyDescription}>
        {messages.description}
      </Text>
      {props.onRetry ? (
        <Pressable
          accessibilityLabel={t(
            'auto.mobile.src.tasks.MobileTaskRuntimeGate.dca0ddc6ab',
            'Retry Runtime connection'
          )}
          accessibilityRole="button"
          onPress={props.onRetry}
          style={({ pressed }) => [
            styles.emptyPrimaryButton,
            pressed && styles.emptyPrimaryButtonPressed
          ]}
        >
          <RefreshCw color={theme.color.text.inverse} size={20} strokeWidth={2} />
          <Text maxFontSizeMultiplier={1.3} style={styles.emptyPrimaryButtonText}>
            {t('auto.mobile.src.tasks.MobileTaskRuntimeGate.4a09ed3c32', 'Retry connection')}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={props.onSelectRuntime}
        style={styles.emptySecondaryButton}
      >
        <Text maxFontSizeMultiplier={1.3} style={styles.emptySecondaryButtonText}>
          {t(
            'auto.mobile.src.tasks.MobileTaskRuntimeGate.0648ffa742',
            'Connect or switch computer'
          )}
        </Text>
      </Pressable>
    </View>
  )
}
