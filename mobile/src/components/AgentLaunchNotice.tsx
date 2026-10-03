import { useState } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { useClipboardWriter } from '../platform/clipboard'
import {
  AGENT_LAUNCH_STATUS_UNREADABLE_MESSAGE,
  AGENT_LAUNCH_UPDATE_REQUIRED_MESSAGE
} from '../session/mobile-existing-agent-launch'
import type { MobileAgentLaunchAvailability } from '../session/mobile-agent-launch-availability'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileThemeStyles } from '../theme/mobile-theme-provider'

type Props = {
  availability: MobileAgentLaunchAvailability
  /** The confirmation that the agent started with its prompt. */
  success: string | null
  error: string | null
  /** The host's note on a launch that went ahead; secondary text, not an error. */
  warning: string | null
  /** The prompt of an agent that started without it, offered for the user to paste in. */
  undeliveredPrompt: string | null
  errorStyle: StyleProp<TextStyle>
}

/** The status line under an AI button that starts an agent with a prompt. */
export function AgentLaunchNotice({
  availability,
  success,
  error,
  warning,
  undeliveredPrompt,
  errorStyle
}: Props) {
  const styles = useMobileThemeStyles(createStyles)
  const clipboard = useClipboardWriter()
  const [copyState, setCopyState] = useState<{ prompt: string; label: string } | null>(null)
  const availabilityMessage =
    availability === 'update-required'
      ? AGENT_LAUNCH_UPDATE_REQUIRED_MESSAGE
      : availability === 'unverified'
        ? AGENT_LAUNCH_STATUS_UNREADABLE_MESSAGE
        : null
  const message = availabilityMessage ?? error
  const note = availabilityMessage ? null : warning
  const confirmation = message ? null : success
  if (!message && !note && !confirmation) {
    return null
  }
  const copyLabel =
    copyState && copyState.prompt === undeliveredPrompt ? copyState.label : '复制提示词'
  return (
    <View style={styles.notice}>
      {confirmation ? <Text style={styles.successText}>{confirmation}</Text> : null}
      {message ? <Text style={errorStyle}>{message}</Text> : null}
      {note ? <Text style={styles.warningText}>{note}</Text> : null}
      {undeliveredPrompt ? (
        <Pressable
          onPress={() => {
            clipboard.writeText(undeliveredPrompt).then(
              () => setCopyState({ prompt: undeliveredPrompt, label: '已复制' }),
              () => setCopyState({ prompt: undeliveredPrompt, label: '无法复制' })
            )
          }}
          accessibilityRole="button"
          accessibilityLabel={copyLabel}
          style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed]}
        >
          <Text style={styles.copyText}>{copyLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    notice: {
      gap: theme.spacing.space4
    },
    successText: {
      ...theme.typography.meta,
      color: theme.color.status.success
    },
    warningText: {
      ...theme.typography.meta,
      color: theme.color.text.secondary
    },
    copyButton: {
      minHeight: theme.size.minimumTouchTarget,
      justifyContent: 'center',
      borderRadius: theme.radii.control,
      paddingHorizontal: theme.spacing.space8
    },
    copyButtonPressed: {
      backgroundColor: theme.color.bg.subtle
    },
    copyText: {
      ...theme.typography.meta,
      color: theme.color.brand.primary,
      fontWeight: '600'
    }
  })
}
