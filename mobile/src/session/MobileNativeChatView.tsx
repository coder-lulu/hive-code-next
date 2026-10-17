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
import { ArrowDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react-native'
import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { createMobileNativeChatViewStyles } from './mobile-native-chat-view-styles'
import { buildMobileNativeChatTransientData } from './mobile-native-chat-render-data'
import { mobileNativeChatListFooter } from './mobile-native-chat-list-footer'
import { mobileNativeChatListHeader } from './mobile-native-chat-list-header'
import { useMobileNativeChatPageHistory } from './use-mobile-native-chat-page-history'
import { useMobileNativeChatPinchGesture } from './use-mobile-native-chat-pinch-gesture'
import {
  mobileNativeChatRowAnchor,
  useMobileNativeChatTailFollow
} from './use-mobile-native-chat-tail-follow'
import { useMobileNativeChatTurnDisclosure } from './use-mobile-native-chat-turn-disclosure'
import {
  mobileNativeChatComposerPlaceholder,
  useSettledMobileNativeChatInputLock
} from './use-mobile-native-chat-input-lease'
import { MobileNativeChatLiveLine } from './MobileNativeChatLiveLine'
import { MobileNativeChatStopButton } from './MobileNativeChatStopButton'
import { MobileAgentWorkingIndicator } from './MobileAgentWorkingIndicator'
import { MobileNativeChatComposer } from './MobileNativeChatComposer'
import { MobileNativeChatMessage } from './MobileNativeChatMessage'
import { MobileNativeChatPromptCard } from './MobileNativeChatPromptCard'
import type { MobileNativeChatViewProps } from './mobile-native-chat-view-props'
import { NO_COMPOSER_TRAY } from './use-mobile-native-chat-composer-tray'
import { MobileNativeChatScrollHold } from './MobileNativeChatScrollHold'
import { mobileNativeChatUnsentNotices } from './mobile-native-chat-unsent-notices'

const EMPTY_ERROR = '无法读取对话记录。你可以切回终端继续工作。'
const EMPTY_HINT = '让 Agent 检查代码、解释输出或进行修改。'

export type { MobileNativeChatInputLockReason } from './mobile-native-chat-view-props'

export function MobileNativeChatView({
  messages,
  folded,
  status,
  error,
  readFailedFinally = false,
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
  onCollapseAsk,
  onCollapsePrompt,
  collapsedPrompt,
  question,
  onAnswerQuestion,
  permission,
  promptKey,
  onRespondPermission,
  composerTray: { content: trayContent, composerInputRef: inputRef } = NO_COMPOSER_TRAY,
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
    detachFromTail,
    pageInputHandlers,
    beginUserScroll,
    endUserDrag,
    beginMomentum,
    endMomentum,
    readerIsScrolling,
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

  const loadEarlier = useCallback(() => onLoadEarlier?.(), [onLoadEarlier])

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = e.nativeEvent
      recordScrollMetrics(e.nativeEvent)
      // Near the top — page in older history. Only the reader's scroll: a pin reports offsets too.
      if (contentOffset.y < 60 && hasMore && !loadingEarlier && readerIsScrolling()) {
        loadEarlier()
      }
    },
    [hasMore, loadingEarlier, loadEarlier, readerIsScrolling, recordScrollMetrics]
  )

  // Per-turn status rows: one live indicator while the turn runs, then a settled
  // "Worked for N" row. The structured lane owns them; the bridge lane keeps its
  // three-dot indicator.
  // The display status, decided once in the session hook.
  const stopping = turnIndicator?.stopping === true
  const turns = useMobileNativeChatTurnDisclosure({
    messages: data,
    enabled: structuredActivityUi,
    isWorking: agentWorking === true,
    workingStartedAt,
    settledTurns,
    turnJournal,
    thinking: turnIndicator?.thinking === true,
    activityText: turnIndicator?.activityText ?? null,
    stopping,
    lineYields: structuredActivityUi && (ask != null || permission != null || question != null),
    scopeKey: sendSurfaceId
  })

  const onScrollToMessage = useCallback(
    (index: number) => {
      detachFromTail()
      listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true })
    },
    [detachFromTail, listRef]
  )

  const unsentNotices = useMemo(
    () => mobileNativeChatUnsentNotices(turnJournal, agent),
    [turnJournal, agent]
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
        unsentNotice={item.unsent ? unsentNotices.get(item.id) : undefined}
        {...turns.resolveRow(index, item)}
      />
    ),
    [
      toolsExpanded,
      fontScale,
      onScrollToMessage,
      onOpenFile,
      structuredActivityUi,
      turns,
      unsentNotices
    ]
  )

  const history = useMobileNativeChatPageHistory(turns.listMessages, renderItem)

  const liveStatus = turns.liveLine ? (
    <MobileNativeChatLiveLine
      line={turns.liveLine}
      onToggleReasoning={turns.onToggleReasoning}
      fontScale={fontScale}
      onOpenFile={onOpenFile}
    />
  ) : null

  const showEmptyState = status === 'error' || status === 'ready' || status === 'waiting-session'
  const emptyTitle =
    status === 'error' ? '无法加载对话' : `开始与 ${formatAgentTypeLabel(agent)} 对话`
  const emptySubtitle = status === 'error' ? (error ?? EMPTY_ERROR) : EMPTY_HINT

  const lockReason = useSettledMobileNativeChatInputLock(inputLockReason)
  // Why only Send, terminal-backed only: that send types into the agent's prompt and can answer it,
  // while drafting never does; the host queues a structured send behind it.
  const expandedPromptOwnsSend =
    !structuredActivityUi && !collapsedPrompt && (ask ?? permission ?? question) != null
  const emptyStateView = showEmptyState ? (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{emptyTitle}</Text>
      <Text style={styles.emptySubtitle}>{emptySubtitle}</Text>
    </View>
  ) : null

  // Whatever was already on screen: nothing here can act on a chat that cannot load, and its words
  // say why once, as a fresh open's do.
  if (readFailedFinally && emptyStateView) {
    return <View style={[styles.root, { paddingBottom: bottomPad }]}>{emptyStateView}</View>
  }

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      {status === 'loading' && messages.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        <GestureHandlerRootView style={styles.listWrap}>
          <MobileNativeChatScrollHold headKey={turns.listMessages[0]?.id} listRef={listRef} />
          <GestureDetector gesture={pinchGesture}>
            <FlatList
              ref={listRef}
              data={history.listRows}
              keyExtractor={(item) => item.id}
              renderItem={history.renderListRow}
              contentContainerStyle={styles.listContent}
              // Let link/file taps land while the composer keyboard is up
              // instead of being swallowed by the dismiss gesture.
              keyboardShouldPersistTaps="handled"
              {...pageInputHandlers}
              onScroll={onScroll}
              onScrollBeginDrag={beginUserScroll}
              onScrollEndDrag={endUserDrag}
              onMomentumScrollBegin={beginMomentum}
              onMomentumScrollEnd={endMomentum}
              scrollEventThrottle={32}
              onContentSizeChange={pinToTailAfterContentResize}
              onLayout={pinToTail}
              maintainVisibleContentPosition={mobileNativeChatRowAnchor(hasMore === true)}
              ListHeaderComponent={history.withHistory(
                mobileNativeChatListHeader(hasMore, loadingEarlier, loadEarlier, theme, styles)
              )}
              ListFooterComponent={mobileNativeChatListFooter(
                liveStatus,
                turns.waitingRows,
                renderItem
              )}
              ListEmptyComponent={emptyStateView}
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
      {trayContent}
      <MobileNativeChatPromptCard
        key={promptKey ?? undefined}
        {...{ ask, askKey, onDismissAsk, onAnswerAsk, onCancelAsk, onCancelPrompt, onCollapseAsk }}
        {...{ permission, onRespondPermission, question, onAnswerQuestion, onCollapsePrompt }}
        collapsedPrompt={collapsedPrompt}
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
          // Only this phone's own request holds Stop: a repeat is how a stuck stop escalates.
          <MobileNativeChatStopButton
            onStop={onStop}
            held={agentWorking === true && turnIndicator?.stopRequestInFlight === true}
          />
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
        sendDisabled={expandedPromptOwnsSend}
        placeholder={mobileNativeChatComposerPlaceholder(lockReason, turnIndicator?.afterStop)}
        filePaths={filePaths}
        onNeedFiles={onNeedFiles}
      />
    </View>
  )
}
