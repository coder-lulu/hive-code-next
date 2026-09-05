import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Text,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import { ArrowDown, ChevronsDownUp, ChevronsUpDown, Square } from 'lucide-react-native'
import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileNativeChatViewStyles } from './mobile-native-chat-view-styles'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'

const INPUT_LOCK_SETTLE_MS = 600
const EMPTY_ERROR = '无法读取对话记录。你可以切回终端继续工作。'
const EMPTY_HINT = '让 Agent 检查代码、解释输出或进行修改。'

export type { MobileNativeChatInputLockReason } from './mobile-native-chat-view-props'

export function MobileNativeChatView({
  messages,
  folded,
  status,
  error,
  agent,
  agentWorking,
  structuredActivityUi = false,
  onStop,
  streaming,
  hasMore,
  loadingEarlier,
  onLoadEarlier,
  onSend,
  sendSurfaceId,
  getSendCompletionGeneration,
  getComposerEditGeneration,
  pending,
  imagePreviewsByMessageId,
  composerText,
  onComposerTextChange,
  onAttachImage,
  attachments,
  onRemoveAttachment,
  isAttaching,
  onMicPress,
  micActive,
  dictationMode,
  onMicPressIn,
  onMicPressOut,
  inputLockReason,
  sendErrorMessage,
  onClearSendError,
  filePaths,
  onNeedFiles,
  sessionOptions,
  ask,
  askKey,
  onDismissAsk,
  onAnswerAsk,
  onCancelAsk,
  question,
  onAnswerQuestion,
  permission,
  onRespondPermission,
  onOpenFile,
  keyboardInset = 0
}: MobileNativeChatViewProps): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatViewStyles)
  const insets = useSafeAreaInsets()
  const listRef = useRef<FlatList<NativeChatMessage>>(null)
  const scrollToIndex = (index: number) =>
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom
  const [atBottom, setAtBottom] = useState(true)
  const sendScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()
  useEffect(
    () => () => {
      if (sendScrollTimerRef.current) {
        clearTimeout(sendScrollTimerRef.current)
      }
    },
    []
  )

  // `data` is the list source: folded transcript + synthetic streaming bubble +
  // route-owned accepted echoes. Memoize on the same deps so the
  // downstream autoscroll effects/`renderItem` keep referential stability.
  const { data } = useMemo(
    () =>
      buildMobileNativeChatTransientData({
        messages,
        folded,
        streaming,
        pending,
        imagePreviewsByMessageId
      }),
    [messages, folded, streaming, pending, imagePreviewsByMessageId]
  )

  // Follow the tail as the conversation grows and keep the newest message above
  // the keyboard when it opens — but only when already pinned to the bottom, so
  // we don't yank the user away while they read history. (Also fires on keyboard
  // close, which is harmless while atBottom.)
  useEffect(() => {
    if (data.length === 0 || !atBottom) {
      return
    }
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60)
    return () => clearTimeout(t)
  }, [data.length, atBottom, keyboardInset])

  const handleSend = useCallback(
    async (text: string): Promise<boolean> => {
      const accepted = await onSend(text)
      if (!accepted) {
        return false
      }
      // The route-owned banner outlives this send; a success must retire it too,
      // or a stale "Message not sent" sits above the delivered message.
      onClearSendError?.()
      // Always jump to the newest message when the user sends.
      setAtBottom(true)
      if (sendScrollTimerRef.current) {
        clearTimeout(sendScrollTimerRef.current)
      }
      sendScrollTimerRef.current = setTimeout(() => {
        sendScrollTimerRef.current = null
        listRef.current?.scrollToEnd({ animated: true })
      }, 60)
      return true
    },
    [onSend, onClearSendError]
  )

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
      const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height)
      setAtBottom(distanceFromBottom < 80)
      // Near the top — page in older history.
      if (contentOffset.y < 60 && hasMore && !loadingEarlier) {
        onLoadEarlier?.()
      }
    },
    [hasMore, loadingEarlier, onLoadEarlier]
  )

  // Align a single message's top to the top of the viewport.
  const onScrollToMessage = useCallback((index: number) => {
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
  }, [])

  // Per-turn "Thinking / Working for N / Worked for N" rows. The structured lane
  // owns them; the bridge lane keeps its three-dot indicator.
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
    scopeKey: sendSurfaceId
  })

  const renderItem = useCallback(
    ({ item, index }: { item: NativeChatMessage; index: number }) => (
      <MobileNativeChatMessage
        message={item}
        toolsExpanded={toolsExpanded}
        fontScale={fontScale}
        messageIndex={index}
        onScrollToMessage={onScrollToMessage}
        onOpenFile={onOpenFile}
        structuredActivityUi={structuredActivityUi}
        onToggleTurn={turns.onToggleTurn}
        {...turns.resolveRow(index, item)}
      />
    ),
    [toolsExpanded, fontScale, onScrollToMessage, onOpenFile, structuredActivityUi, turns]
  )

  const showEmptyState = status === 'error' || status === 'ready' || status === 'waiting-session'
  const emptyTitle =
    status === 'error' ? '无法加载对话' : `开始与 ${formatAgentTypeLabel(agent)} 对话`
  const emptySubtitle = status === 'error' ? (error ?? EMPTY_ERROR) : EMPTY_HINT

  // A dead PTY emits subscribed→end; settle both edges so its false lease cannot flash the composer enabled.
  const [lockHeld, setLockHeld] = useState(false)
  useEffect(() => {
    if ((inputLockReason != null) === lockHeld) {
      return
    }
    const timer = setTimeout(() => setLockHeld(inputLockReason != null), INPUT_LOCK_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [inputLockReason, lockHeld])
  const lockReason = lockHeld ? (inputLockReason ?? 'waiting') : null

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {status === 'loading' && messages.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <GestureDetector gesture={pinchGesture}>
            <FlatList
              ref={listRef}
              data={data}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              // Let link/file taps land while the composer keyboard is up
              // instead of being swallowed by the dismiss gesture.
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              scrollEventThrottle={32}
              onContentSizeChange={() => {
                if (data.length > 0 && atBottom) {
                  listRef.current?.scrollToEnd({ animated: false })
                }
              }}
              // scrollToIndex can fail before an off-screen row is measured —
              // fall back to an estimated offset, then retry once it's laid out.
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true
                })
                setTimeout(() => scrollToIndex(info.index), 120)
              }}
              ListHeaderComponent={
                hasMore ? (
                  <Pressable
                    style={styles.loadEarlier}
                    onPress={onLoadEarlier}
                    disabled={loadingEarlier}
                  >
                    {loadingEarlier ? (
                      <ActivityIndicator size="small" color={theme.color.text.tertiary} />
                    ) : (
                      <Text style={styles.loadEarlierText}>加载更早的消息</Text>
                    )}
                  </Pressable>
                ) : null
              }
              ListFooterComponent={
                turns.activeTurnIsUnanchored && turns.active ? (
                  <MobileNativeChatTurnStatus
                    startedAt={turns.active.startedAt}
                    thinking={turns.active.thinking}
                    workedSeconds={turns.active.workedSeconds}
                  />
                ) : null
              }
              ListEmptyComponent={
                showEmptyState ? (
                  <View style={styles.center}>
                    <Text style={styles.emptyTitle}>{emptyTitle}</Text>
                    <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
                  </View>
                ) : null
              }
            />
          </GestureDetector>
          {/* Jump-to-latest control. The scroll-to-top affordance now lives
              per-message (the up-arrow in each agent message's controls). */}
          {!atBottom ? (
            <Pressable
              accessibilityLabel="滚动到最新消息"
              style={[styles.fab, styles.fabBottom]}
              onPress={() => listRef.current?.scrollToEnd({ animated: true })}
            >
              <ArrowDown size={20} color={theme.color.text.primary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </GestureHandlerRootView>
      )}
      <MobileNativeChatPromptCard
        ask={ask}
        askKey={askKey}
        onDismissAsk={onDismissAsk}
        onAnswerAsk={onAnswerAsk}
        onCancelAsk={onCancelAsk}
        permission={permission}
        onRespondPermission={onRespondPermission}
        question={question}
        onAnswerQuestion={onAnswerQuestion}
      />
      {/* Chrome row above the composer: the working indicator and the global
          tool-calls expand/collapse toggle on the left, Stop in the far corner. */}
      <View style={styles.chromeRow}>
        <View style={styles.chromeLeft}>
          {agentWorking && !structuredActivityUi ? <MobileAgentWorkingIndicator /> : null}
          <Pressable
            style={({ pressed }) => [styles.chromeToggle, pressed && styles.pressed]}
            onPress={() => setToolsExpanded((v) => !v)}
            hitSlop={8}
          >
            {toolsExpanded ? (
              <ChevronsDownUp size={16} color={theme.color.text.tertiary} strokeWidth={2} />
            ) : (
              <ChevronsUpDown size={16} color={theme.color.text.tertiary} strokeWidth={2} />
            )}
            <Text style={styles.chromeToggleLabel}>{toolsExpanded ? '收起' : '工具'}</Text>
          </Pressable>
        </View>
        {agentWorking ? (
          <Pressable
            style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
            onPress={onStop}
            hitSlop={8}
            accessibilityLabel="停止 Agent"
          >
            <Square
              size={16}
              color={theme.color.status.danger}
              strokeWidth={2.2}
              fill={theme.color.status.danger}
            />
            <Text style={styles.stopLabel}>停止</Text>
          </Pressable>
        ) : null}
      </View>
      {sendErrorMessage ? (
        // This banner is the only channel for a send failure — announce it.
        <View
          style={styles.sendError}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={styles.sendErrorText}>{sendErrorMessage}</Text>
        </View>
      ) : null}
      <MobileNativeChatComposer
        value={composerText}
        onChangeText={onComposerTextChange}
        onSend={handleSend}
        sendSurfaceId={sendSurfaceId}
        {...{ getSendCompletionGeneration, getComposerEditGeneration }}
        agent={agent}
        sessionOptions={sessionOptions}
        onAttachImage={onAttachImage}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        isAttaching={isAttaching}
        onMicPress={onMicPress}
        micActive={micActive}
        dictationMode={dictationMode}
        onMicPressIn={onMicPressIn}
        onMicPressOut={onMicPressOut}
        disabled={lockReason !== null}
        placeholder={
          lockReason === 'disconnected'
            ? '正在重新连接…'
            : lockReason === 'waiting'
              ? '正在等待终端…'
              : '输入消息，支持 @文件、/命令'
        }
        filePaths={filePaths}
        onNeedFiles={onNeedFiles}
      />
    </View>
  )
}
