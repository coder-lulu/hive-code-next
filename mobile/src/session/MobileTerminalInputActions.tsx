import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle
} from 'react-native'
import { ImagePlus, Mic } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'

type DictationState = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalInputActionsProps = {
  readonly canSend: boolean
  readonly isAttaching: boolean
  readonly dictation: DictationState
  readonly dictationMode: 'toggle' | 'hold'
  readonly buttonStyle: StyleProp<ViewStyle>
  readonly activeButtonStyle: StyleProp<ViewStyle>
  readonly disabledButtonStyle: StyleProp<ViewStyle>
  readonly onAttachImage: () => void
  readonly onAttachFile: () => void
  readonly onDictationToggle: () => void
  readonly onDictationPressIn: () => void
  readonly onDictationPressOut: () => void
  readonly onDictationCancel: () => void
}

// Image + mic peer actions shared by the live and buffered input bars so both
// surfaces offer identical multimodal entry points (and the JSX lives once).
export function MobileTerminalInputActions({
  canSend,
  isAttaching,
  dictation,
  dictationMode,
  buttonStyle,
  activeButtonStyle,
  disabledButtonStyle,
  onAttachImage,
  onAttachFile,
  onDictationToggle,
  onDictationPressIn,
  onDictationPressOut,
  onDictationCancel
}: MobileTerminalInputActionsProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const attachmentUnavailable = !canSend || isAttaching
  const dictationSelected = dictation.isStarting || dictation.isRecording
  const dictationBusy = dictation.isStarting || dictation.isProcessing

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          buttonStyle,
          styles.actionButton,
          pressed && !attachmentUnavailable && styles.buttonPressed,
          attachmentUnavailable && disabledButtonStyle,
          attachmentUnavailable && styles.buttonDisabled
        ]}
        disabled={attachmentUnavailable}
        // Tap opens the photo library; long-press picks a file. Uploads via host
        // RPC so SSH/remote sessions attach the same as local ones.
        onPress={onAttachImage}
        onLongPress={onAttachFile}
        delayLongPress={350}
        accessibilityRole="button"
        accessibilityLabel={isAttaching ? '正在发送图片' : '附加照片'}
        accessibilityHint="长按可改为附加文件"
        accessibilityState={{ busy: isAttaching, disabled: attachmentUnavailable }}
      >
        {isAttaching ? (
          <ActivityIndicator size="small" color={theme.color.text.secondary} />
        ) : (
          <ImagePlus
            size={theme.spacing.space20}
            color={theme.color.text.secondary}
            strokeWidth={2}
          />
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          buttonStyle,
          styles.actionButton,
          dictationSelected && activeButtonStyle,
          dictationSelected && styles.actionButtonSelected,
          pressed && canSend && styles.buttonPressed,
          !canSend && disabledButtonStyle,
          !canSend && styles.buttonDisabled
        ]}
        disabled={!canSend}
        onPress={dictationMode === 'toggle' ? onDictationToggle : undefined}
        onPressIn={dictationMode === 'hold' ? onDictationPressIn : undefined}
        onPressOut={dictationMode === 'hold' ? onDictationPressOut : undefined}
        onLongPress={
          dictationMode === 'toggle'
            ? () => {
                if (dictation.isRecording || dictation.isProcessing) {
                  onDictationCancel()
                }
              }
            : undefined
        }
        accessibilityRole="button"
        accessibilityLabel={
          dictation.isRecording
            ? '停止语音输入'
            : dictation.isProcessing
              ? '取消语音输入'
              : dictation.isStarting
                ? '正在启动语音输入'
                : '开始语音输入'
        }
        accessibilityState={{
          busy: dictationBusy,
          disabled: !canSend,
          selected: dictationSelected
        }}
      >
        {dictation.isProcessing ? (
          <ActivityIndicator size="small" color={theme.color.text.secondary} />
        ) : (
          <Mic
            size={theme.spacing.space20}
            color={dictationSelected ? theme.color.text.inverse : theme.color.text.secondary}
            strokeWidth={2}
          />
        )}
      </Pressable>
    </>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    actionButton: {
      minWidth: theme.size.minimumTouchTarget,
      minHeight: theme.size.minimumTouchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.color.border.default,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    actionButtonSelected: {
      borderColor: theme.color.bg.selected,
      backgroundColor: theme.color.bg.selected
    },
    buttonPressed: { opacity: 0.72 },
    buttonDisabled: { opacity: 0.4 }
  })
}
