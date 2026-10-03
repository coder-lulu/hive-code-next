import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useClipboardWriter } from '../platform/clipboard'
import { triggerError } from '../platform/haptics'
import { Check, Copy, Pencil, Play, Trash2 } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import {
  getQuickCommandDisplayPreview,
  getTerminalQuickCommandBody,
  isAgentQuickCommand
} from '../terminal/quick-commands'

type QuickCommandRowProps = {
  command: TerminalQuickCommand
  first: boolean
  onLaunch: (command: TerminalQuickCommand) => void
  onEdit: (command: TerminalQuickCommand) => void
  onDelete: (command: TerminalQuickCommand) => void
  disabled: boolean
}

type CopyFeedback = {
  body: string
  status: 'copied' | 'failed'
}

export function QuickCommandRow({
  command,
  first,
  onLaunch,
  onEdit,
  onDelete,
  disabled
}: QuickCommandRowProps) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const clipboard = useClipboardWriter()
  const isAgent = isAgentQuickCommand(command)
  const body = getTerminalQuickCommandBody(command)
  const canCopy = body.trim().length > 0
  // Why: key feedback to the copied body so a prop change drops stale labels
  // without setState-in-effect (react-doctor no-adjust-state-on-prop-change).
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const copyStatus: 'idle' | 'copied' | 'failed' =
    feedback != null && feedback.body === body ? feedback.status : 'idle'

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  // Drop any pending reset timer when the body changes; display status is already idle.
  useEffect(() => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = null
    }
  }, [body])

  const handleCopy = async (): Promise<void> => {
    if (!canCopy || disabled) {
      return
    }
    try {
      await clipboard.writeText(body)
      if (!mountedRef.current) {
        return
      }
      setFeedback({ body, status: 'copied' })
    } catch {
      // The guard first: a row unmounted before the refusal arrives has nothing to explain a buzz
      // with, and the feedback it would set is read by a component that is gone.
      if (!mountedRef.current) {
        return
      }
      // The row says so on its own control rather than in a toast; the buzz is the part a thumb
      // resting on the button it just pressed can notice without looking.
      triggerError()
      setFeedback({ body, status: 'failed' })
    }
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current)
    }
    copyResetTimerRef.current = setTimeout(() => {
      copyResetTimerRef.current = null
      if (mountedRef.current) {
        setFeedback(null)
      }
    }, 1500)
  }

  const copyDisabled = disabled || !canCopy
  const copyLabel =
    copyStatus === 'copied'
      ? '已复制'
      : copyStatus === 'failed'
        ? '无法复制'
        : canCopy
          ? `复制 ${command.label}`
          : '无可复制内容'
  const copyIconColor =
    copyStatus === 'copied'
      ? theme.color.status.success
      : copyStatus === 'failed'
        ? theme.color.status.danger
        : theme.color.text.secondary

  return (
    <View style={[styles.row, !first && styles.rowBorder, disabled && styles.disabled]}>
      <Pressable
        style={({ pressed }) => [styles.rowMain, pressed && !disabled && styles.pressed]}
        disabled={disabled}
        onPress={() => onLaunch(command)}
        accessibilityRole="button"
        accessibilityLabel={`运行 ${command.label}`}
      >
        <View style={styles.rowIcon}>
          {isAgent ? (
            <MobileAgentIcon agentId={command.agent} size={16} />
          ) : (
            <Play size={16} color={theme.color.text.primary} fill={theme.color.text.primary} />
          )}
        </View>
        <View style={styles.rowText}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {command.label}
          </Text>
          <Text style={[styles.rowPreview, !isAgent && styles.mono]} numberOfLines={1}>
            {getQuickCommandDisplayPreview(command)}
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.rowAction,
          // Why: row already dims when `disabled`; only dim again for empty body.
          !canCopy && styles.disabled,
          pressed && !copyDisabled && styles.pressed
        ]}
        disabled={copyDisabled}
        onPress={() => void handleCopy()}
        accessibilityRole="button"
        accessibilityLabel={copyLabel}
        accessibilityState={{ disabled: copyDisabled }}
      >
        {copyStatus === 'copied' ? (
          <Check size={15} color={copyIconColor} />
        ) : (
          <Copy size={15} color={copyIconColor} />
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.rowAction, pressed && !disabled && styles.pressed]}
        disabled={disabled}
        onPress={() => onEdit(command)}
        accessibilityLabel={`编辑 ${command.label}`}
      >
        <Pencil size={16} color={theme.color.text.secondary} />
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.rowAction, pressed && !disabled && styles.pressed]}
        disabled={disabled}
        onPress={() => onDelete(command)}
        accessibilityLabel={`删除 ${command.label}`}
      >
        <Trash2 size={16} color={theme.color.status.danger} />
      </Pressable>
    </View>
  )
}

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    pressed: { backgroundColor: theme.color.bg.subtle },
    disabled: { opacity: 0.45 },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowBorder: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border.subtle
    },
    rowMain: {
      minHeight: theme.size.groupedListRowMinHeight,
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space12,
      paddingVertical: theme.spacing.space12,
      paddingLeft: theme.spacing.space12,
      minWidth: 0
    },
    rowIcon: {
      width: theme.spacing.space32,
      height: theme.spacing.space32,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle,
      alignItems: 'center',
      justifyContent: 'center'
    },
    rowText: { flex: 1, minWidth: 0 },
    rowLabel: { ...theme.typography.label, fontWeight: '600', color: theme.color.text.primary },
    rowPreview: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      marginTop: theme.spacing.space4
    },
    mono: { ...theme.typography.code },
    rowAction: {
      width: theme.size.minimumTouchTarget,
      height: theme.size.groupedListRowMinHeight,
      alignItems: 'center',
      justifyContent: 'center'
    }
  })
}
