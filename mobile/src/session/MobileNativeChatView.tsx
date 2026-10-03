import { useCallback, useMemo, useState } from 'react'
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
import { mobileNativeChatListFooter } from './mobile-native-chat-list-footer'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import { useMobileNativeChatTailFollow } from './use-mobile-native-chat-tail-follow'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import { useSettledMobileNativeChatInputLock } from './use-mobile-native-chat-input-lease'
import { MobileNativeChatTurnActivity } from './MobileNativeChatTurnStatus'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { NO_QUEUED_SLOT } from './use-mobile-native-chat-queued-slot'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'

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
  canStop = agentWorking,
  structuredActivityUi = false,
  turnIndicator = null,
  workingStartedAt,
  settledTurns,
  turnJournal = null,
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
  onCancelPrompt,
  question,
  onAnswerQuestion,
  permission,
  onRespondPermission,
  queuedSlot: { cards: queuedCards, composerInputRef: inputRef } = NO_QUEUED_SLOT,
  onOpenFile,
  keyboardInset = 0
}: MobileNativeChatViewProps): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatViewStyles)
  const insets = useSafeAreaInsets()
  const [toolsExpanded, setToolsExpanded] = useState(false)
  // Lift the composer clear of the keyboard, plus the bottom safe-area so it
  // never sits under the home indicator / nav bar (mirrors the terminal dock).
  const bottomPad = keyboardInset > 0 ? keyboardInset + insets.bottom : insets.bottom
  const { fontScale, pinchGesture } = useMobileNativeChatPinchGesture()

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
  const {
    listRef,
    showJumpToTail,
    pinToTail,
    pinToTailAfterContentResize,
    jumpToTail,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    detachFromTail,
    recordScrollMetrics
  } = useMobileNativeChatTailFollow<NativeChatMessage>({ hasItems: data.length > 0 })

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
      jumpToTail()
      return true
    },
    [onSend, onClearSendError, jumpToTail]
  )

  const loadEarlier = useCallback(() => {
    detachFromTail()
    onLoadEarlier?.()
  }, [detachFromTail, onLoadEarlier])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = e.nativeEvent
      recordScrollMetrics(e.nativeEvent)
      // Near the top — page in older history.
      if (contentOffset.y < 60 && hasMore && !loadingEarlier) {
        loadEarlier()
      }
    },
    [hasMore, loadingEarlier, loadEarlier, recordScrollMetrics]
  )

  // Per-turn status rows: one live indicator while the turn runs, then a settled
  // "Worked for N" row. The structured lane owns them; the bridge lane keeps its
  // three-dot indicator.
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
    workingStartedAt,
    settledTurns,
    turnJournal,
    thinking: turnIndicator?.thinking === true,
    activityText: turnIndicator?.activityText ?? null,
    scopeKey: sendSurfaceId
  })
  const hasPendingStructuredInteraction =
    structuredActivityUi && (ask != null || permission != null || question != null)

  const onScrollToMessage = useCallback(
    (index: number) => {
      detachFromTail()
      listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
    },
    [detachFromTail, listRef]
  )

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

  const liveStatus =
    structuredActivityUi && agentWorking && !hasPendingStructuredInteraction && turns.active ? (
      <MobileNativeChatTurnActivity
        thinking={turns.active.thinking}
        activityText={turns.activeActivityText}
      />
    ) : null

  const showEmptyState = status === 'error' || status === 'ready' || status === 'waiting-session'
  const emptyTitle =
    status === 'error' ? '无法加载对话' : `开始与 ${formatAgentTypeLabel(agent)} 对话`
  const emptySubtitle = status === 'error' ? (error ?? EMPTY_ERROR) : EMPTY_HINT

  const lockReason = useSettledMobileNativeChatInputLock(inputLockReason)

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
              data={turns.listMessages}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              // Let link/file taps land while the composer keyboard is up
              // instead of being swallowed by the dismiss gesture.
              keyboardShouldPersistTaps="handled"
              onScroll={onScroll}
              onScrollBeginDrag={beginUserScroll}
              onScrollEndDrag={endUserDrag}
              onMomentumScrollBegin={beginMomentum}
              onMomentumScrollEnd={endMomentum}
              scrollEventThrottle={32}
              onContentSizeChange={pinToTailAfterContentResize}
              onLayout={pinToTail}
              // scrollToIndex can fail before an off-screen row is measured —
              // fall back to an estimated offset, then retry once it's laid out.
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true
                })
                setTimeout(() => onScrollToMessage(info.index), 120)
              }}
              ListHeaderComponent={
                hasMore ? (
                  <Pressable
                    style={styles.loadEarlier}
                    onPress={loadEarlier}
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
              ListFooterComponent={mobileNativeChatListFooter(
                liveStatus,
                turns.waitingRows,
                renderItem
              )}
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
          {/* Jump-to-latest control. */}
          {showJumpToTail ? (
            <Pressable
              accessibilityLabel="滚动到最新消息"
              style={[styles.fab, styles.fabBottom]}
              onPress={jumpToTail}
            >
              <ArrowDown size={20} color={theme.color.text.primary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </GestureHandlerRootView>
      )}
      {queuedCards}
      <MobileNativeChatPromptCard
        ask={ask}
        askKey={askKey}
        onDismissAsk={onDismissAsk}
        onAnswerAsk={onAnswerAsk}
        onCancelAsk={onCancelAsk}
        onCancelPrompt={onCancelPrompt}
        permission={permission}
        onRespondPermission={onRespondPermission}
        question={question}
        onAnswerQuestion={onAnswerQuestion}
      />
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
        {canStop ? (
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
        structuredCommands={
          structuredActivityUi ? (sessionOptions?.controller.conversationCommands ?? []) : undefined
        }
        value={composerText}
        onChangeText={onComposerTextChange}
        onSend={handleSend}
        sendSurfaceId={sendSurfaceId}
        {...{ getSendCompletionGeneration, getComposerEditGeneration, inputRef }}
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
