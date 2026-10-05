import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  View
} from 'react-native'
import { ArrowUp, ImagePlus, Mic, Square, X } from 'lucide-react-native'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileNativeChatComposerStyles } from './mobile-native-chat-composer-styles'
import { getVerifiedNativeChatCommands } from '../../../src/shared/native-chat-agent-profiles'
import { structuredSlashCommands } from '../../../src/shared/structured-agent-session-composer'
import type { AgentSessionConversationCommand } from '../../../src/shared/agent-session-conversation-command'
import {
  applyAutocomplete,
  detectAutocompleteTrigger,
  rankSlashCommandSuggestions,
  rankSuggestions
} from './mobile-native-chat-autocomplete'
import {
  composerSuggestionInsertText,
  MobileNativeChatComposerSuggestions,
  type ComposerSuggestion
} from './MobileNativeChatComposerSuggestions'
import {
  MobileNativeChatSessionOptionPickers,
  type MobileNativeChatSessionOptionPickersProps
} from './MobileNativeChatSessionOptionPickers'
import type { PendingNativeChatImage } from './mobile-native-chat-image-attachment'
import { keepHeldPressThroughLongPress } from './held-press-long-press'

const NO_FILE_PATHS: string[] = []
const NO_ATTACHMENTS: PendingNativeChatImage[] = []

type Props = {
  /** Lets the owner focus the field, e.g. after Edit moves a queued message into it. */
  inputRef?: React.Ref<TextInput>
  structuredCommands?: readonly AgentSessionConversationCommand[]
  /** Controlled composer text — owned by the parent so dictation can write to it. */
  value: string
  onChangeText: (text: string) => void
  onSend: (text: string) => Promise<boolean>
  /** Changes whenever the route focuses a different chat composer surface. */
  sendSurfaceId: string
  /** Reads the retained route's focus generation without forcing a screen render. */
  getSendCompletionGeneration: () => number
  /** Reads user draft mutations owned above this renderable composer. */
  getComposerEditGeneration: () => number
  /** Active tab's agent — the slash autocomplete serves its command catalog. */
  agent?: string | null
  /** Model/session-option pickers shown in the composer action row; null when
   *  the agent has no session-option catalog. */
  sessionOptions?: MobileNativeChatSessionOptionPickersProps | null
  onAttachImage?: () => void
  /** Images picked-and-uploaded but not yet sent — shown as removable thumbnails
   *  and ridden along on the next send (desktop native-chat parity). */
  attachments?: PendingNativeChatImage[]
  onRemoveAttachment?: (id: string) => void
  isAttaching?: boolean
  onMicPress?: () => void
  micActive?: boolean
  /** Dictation trigger style — 'hold' uses press-in/out, 'toggle' uses tap. */
  dictationMode?: string
  onMicPressIn?: () => void
  onMicPressOut?: () => void
  disabled?: boolean
  placeholder?: string
  filePaths?: string[]
  onNeedFiles?: (query: string) => void
}

export function MobileNativeChatComposer({
  inputRef,
  value,
  onChangeText,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  agent,
  structuredCommands,
  sessionOptions,
  onAttachImage,
  attachments = NO_ATTACHMENTS,
  onRemoveAttachment,
  isAttaching = false,
  onMicPress,
  micActive = false,
  dictationMode = 'toggle',
  onMicPressIn,
  onMicPressOut,
  disabled = false,
  placeholder = '输入消息，支持 @文件、/命令',
  filePaths = NO_FILE_PATHS,
  onNeedFiles
}: Props): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatComposerStyles)
  const [cursor, setCursor] = useState(0)
  // Transiently drives the native caret after a mid-text autocomplete insert,
  // then released on the next selection change so manual caret placement still
  // works (a permanently controlled `selection` breaks it in React Native).
  const [pendingSelection, setPendingSelection] = useState<{ start: number; end: number } | null>(
    null
  )
  const sendingRef = useRef(false)
  const mountedRef = useRef(true)
  const sendSurfaceIdRef = useRef(sendSurfaceId)
  const sendSurfaceGenerationRef = useRef(0)
  useLayoutEffect(() => {
    if (sendSurfaceIdRef.current !== sendSurfaceId) {
      sendSurfaceIdRef.current = sendSurfaceId
      sendSurfaceGenerationRef.current += 1
    }
  }, [sendSurfaceId])
  const [sending, setSending] = useState(false)
  const trimmed = value.trim()
  const sessionOptionDispatching = sessionOptions?.controller.pendingId != null
  // An attached image alone is a valid send (desktop parity), so the image rides
  // along even when the user sends no accompanying text.
  const canSend =
    (trimmed.length > 0 || attachments.length > 0) &&
    !disabled &&
    !sending &&
    !isAttaching &&
    !sessionOptionDispatching

  const trigger = useMemo(() => detectAutocompleteTrigger(value, cursor), [value, cursor])
  const suggestions = useMemo<ComposerSuggestion[]>(() => {
    if (!trigger) {
      return []
    }
    if (trigger.kind === 'slash') {
      const commands =
        structuredCommands !== undefined
          ? structuredSlashCommands(structuredCommands, agent)
          : agent
            ? getVerifiedNativeChatCommands(agent)
            : []
      // Why: Codex's catalog is 45 commands and this list is a plain ScrollView
      // (~5 rows visible), so an uncapped `/` would mount every row and
      // re-reconcile them on each streaming tick right above the transcript.
      return rankSlashCommandSuggestions(commands, trigger.query, 12).map((command) => ({
        kind: 'command' as const,
        command
      }))
    }
    return rankSuggestions(filePaths, trigger.query).map((path) => ({
      kind: 'file' as const,
      path
    }))
  }, [trigger, filePaths, agent, structuredCommands])

  useEffect(() => {
    if (trigger?.kind === 'file') {
      onNeedFiles?.(trigger.query)
    }
  }, [onNeedFiles, trigger?.kind, trigger?.query])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sendSurfaceGenerationRef.current += 1
    }
  }, [])

  const pickSuggestion = (suggestion: ComposerSuggestion): void => {
    if (!trigger) {
      return
    }
    const { text: nextText, cursor: nextCursor } = applyAutocomplete(
      value,
      trigger,
      composerSuggestionInsertText(suggestion)
    )
    onChangeText(nextText)
    setCursor(nextCursor)
    setPendingSelection({ start: nextCursor, end: nextCursor })
  }

  const handleSend = async (): Promise<void> => {
    if (!canSend || sendingRef.current) {
      return
    }
    sendingRef.current = true
    setSending(true)
    const sendSurfaceGeneration = sendSurfaceGenerationRef.current
    const sendCompletionGeneration = getSendCompletionGeneration()
    const composerEditGeneration = getComposerEditGeneration()
    try {
      // Raw, not trimmed: the send seam owns the wire trim, and a rejection has
      // to hand the user back exactly what they typed (#14819).
      const accepted = await onSend(value)
      if (
        accepted &&
        mountedRef.current &&
        sendSurfaceGeneration === sendSurfaceGenerationRef.current &&
        sendCompletionGeneration === getSendCompletionGeneration() &&
        composerEditGeneration === getComposerEditGeneration()
      ) {
        setCursor(0)
        // Why: the turn is now the agent's — the keyboard would cover the reply.
        // A rejected send keeps it up so the handed-back draft stays editable.
        Keyboard.dismiss()
      }
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <View>
      {suggestions.length > 0 ? (
        <MobileNativeChatComposerSuggestions suggestions={suggestions} onPick={pickSuggestion} />
      ) : null}
      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.attachmentStrip}
          contentContainerStyle={styles.attachmentStripContent}
        >
          {attachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachmentThumb}>
              <Image
                source={{ uri: attachment.previewUri }}
                style={styles.attachmentImage}
                resizeMode="cover"
              />
              {onRemoveAttachment ? (
                <Pressable
                  accessibilityLabel="移除图片"
                  style={styles.attachmentRemove}
                  onPress={() => onRemoveAttachment(attachment.id)}
                  hitSlop={8}
                >
                  <X size={16} color={theme.color.text.primary} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.composerInset} testID="native-chat-composer-inset">
        <View style={styles.bar} testID="native-chat-composer">
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
            // Controlled only transiently right after an autocomplete insert.
            selection={pendingSelection ?? undefined}
            onSelectionChange={(e) => {
              setCursor(e.nativeEvent.selection.end)
              setPendingSelection(null)
            }}
            placeholder={placeholder}
            placeholderTextColor={theme.color.text.tertiary}
            selectionColor={theme.color.brand.primary}
            multiline
            // Why: never revoke `editable` — iOS resigns first responder on a focused
            // field, so a transient lock would yank the keyboard mid-typing (#10681).
            // The lock gates sending; the draft survives and rides the next send.
            textAlignVertical="top"
          />
          <View style={styles.actionRow} testID="native-chat-composer-actions">
            {onAttachImage ? (
              <Pressable
                accessibilityLabel="添加图片"
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                onPress={onAttachImage}
                disabled={isAttaching || disabled}
              >
                {isAttaching ? (
                  <ActivityIndicator size="small" color={theme.color.text.secondary} />
                ) : (
                  <ImagePlus size={20} color={theme.color.text.secondary} strokeWidth={2} />
                )}
              </Pressable>
            ) : null}
            {sessionOptions ? (
              <MobileNativeChatSessionOptionPickers
                {...sessionOptions}
                sendInFlight={sending || isAttaching}
              />
            ) : null}
            <View style={styles.actionSpacer} />
            {onMicPress ? (
              <Pressable
                accessibilityLabel={micActive ? '停止语音输入' : '语音输入'}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                // Hold mode is walkie-talkie (press-in/out); toggle mode taps.
                onPress={dictationMode === 'hold' ? undefined : onMicPress}
                onPressIn={dictationMode === 'hold' ? onMicPressIn : undefined}
                onPressOut={dictationMode === 'hold' ? onMicPressOut : undefined}
                onLongPress={dictationMode === 'hold' ? keepHeldPressThroughLongPress : undefined}
                disabled={disabled}
              >
                {/* The icon swaps on press; as the page's touch target, its removal would send
                    touchend to a detached node and lose the release. */}
                {micActive ? (
                  <Square
                    pointerEvents="none"
                    size={18}
                    color={theme.color.status.danger}
                    strokeWidth={2.4}
                    fill={theme.color.status.danger}
                  />
                ) : (
                  <Mic
                    pointerEvents="none"
                    size={20}
                    color={theme.color.text.secondary}
                    strokeWidth={2}
                  />
                )}
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="发送消息"
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.sendButtonDisabled,
                pressed && canSend && styles.pressed
              ]}
              onPress={handleSend}
              disabled={!canSend}
            >
              <ArrowUp
                size={20}
                color={canSend ? theme.color.text.inverse : theme.color.text.tertiary}
                strokeWidth={2.6}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  )
}
