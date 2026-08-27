import { StyleSheet, Text, View } from 'react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

type DictationStatus = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: DictationStatus
  readonly isAttaching: boolean
  readonly liveInputText: string
}

export function MobileTerminalLiveInputStatus({
  dictation,
  isAttaching,
  liveInputText
}: MobileTerminalLiveInputStatusProps) {
  const styles = useMobileThemeStyles(createStyles)
  const title = dictation.isRecording
    ? '正在聆听'
    : dictation.isProcessing
      ? '正在处理'
      : dictation.isStarting
        ? '正在启动麦克风'
        : '实时输入'
  const detail = dictation.isRecording
    ? '轻点麦克风停止'
    : dictation.isProcessing
      ? '正在电脑上转写'
      : dictation.isStarting
        ? '正在准备麦克风'
        : isAttaching
          ? '正在将图片上传到电脑'
          : liveInputText || '轻点显示键盘'

  return (
    <View
      accessible
      accessibilityLabel={`${title}：${detail}`}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={styles.status}
    >
      <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text
        ellipsizeMode="head"
        maxFontSizeMultiplier={1.3}
        numberOfLines={1}
        style={styles.detail}
      >
        {detail}
      </Text>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    status: {
      flex: 1,
      gap: theme.spacing.space4
    },
    title: {
      ...theme.typography.meta,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    detail: {
      ...theme.typography.code,
      color: theme.color.text.secondary
    }
  })
}
