import { MobileSelectableText as Text } from '../components/MobileSelectableText'
import { memo, useCallback } from 'react'
import { ArrowUp, Copy } from 'lucide-react-native'
import { Image, Pressable, View } from 'react-native'
import { splitNativeChatBlocks } from '../../../src/shared/native-chat-tool-fold'
import { selectActiveToolCall } from '../../../src/shared/native-chat-tool-activity'
import { isImageRefBlock, isTextBlock } from '../../../src/shared/native-chat-types'
import {
  AGENT_SESSION_HOST_STATUS_COPY,
  isAgentSessionHostStatusPresentation
} from '../../../src/shared/agent-session-host-status-rows'
import type { NativeChatBlock, NativeChatMessage } from '../../../src/shared/native-chat-types'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { useClipboardWriter } from '../platform/clipboard'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import { MobileNativeChatTurnStatus } from './MobileNativeChatTurnStatus'
import { ToolRun } from './MobileNativeChatToolRun'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'
import { isRenderableImageUri } from './mobile-native-chat-image-preview'
import { createMobileNativeChatMessageStyles } from './mobile-native-chat-message-styles'
import { nativeChatMessageText } from './mobile-native-chat-message-text'

function Prose({
  block,
  invert,
  fontScale,
  onOpenFile
}: {
  block: NativeChatBlock
  invert?: boolean
  fontScale: number
  onOpenFile?: (relativePath: string) => void
}): React.JSX.Element | null {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatMessageStyles)
  if (isTextBlock(block)) {
    if (isAgentSessionHostStatusPresentation(block.presentation)) {
      return (
        <Text
          selectable
          style={[
            styles.hostNotice,
            {
              fontSize: theme.typography.body.fontSize * fontScale,
              lineHeight: theme.typography.body.lineHeight * fontScale
            }
          ]}
        >
          {AGENT_SESSION_HOST_STATUS_COPY[block.presentation]}
        </Text>
      )
    }
    // Inverted (user) bubbles use a fixed dark-on-light text rather than the
    // markdown renderer's light-on-dark palette.
    if (invert) {
      return (
        <Text
          selectable
          style={[
            styles.userText,
            {
              fontSize: theme.typography.body.fontSize * fontScale,
              lineHeight: theme.typography.body.lineHeight * fontScale
            }
          ]}
        >
          {block.text}
        </Text>
      )
    }
    return (
      <MobileMarkdown
        content={block.text}
        rangeSelectable
        textScale={1.25 * fontScale}
        onOpenFile={onOpenFile}
      />
    )
  }
  if (isImageRefBlock(block)) {
    // A local preview (composer echo) or real URL renders as a thumbnail; a bare
    // host path (not loadable on the device) falls back to a text placeholder.
    const uri = block.url ?? block.path
    if (isRenderableImageUri(uri)) {
      return (
        <Image
          source={{ uri }}
          style={styles.imageThumb}
          resizeMode="contain"
          accessibilityLabel={block.alt ?? '已附加图片'}
        />
      )
    }
    return (
      <Text
        style={[
          styles.imageRef,
          {
            fontSize: theme.typography.body.fontSize * fontScale,
            lineHeight: theme.typography.body.lineHeight * fontScale
          }
        ]}
      >
        图片：{block.alt ?? block.path ?? block.url ?? '图像'}
      </Text>
    )
  }
  return null
}

/** Subtle top-right controls for an agent message: copy its prose, or scroll so
 *  this message's top aligns to the top of the viewport. */
function AgentControls({
  onCopy,
  onScrollToTop
}: {
  onCopy: () => void
  onScrollToTop?: () => void
}): React.JSX.Element {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createMobileNativeChatMessageStyles)
  return (
    <View style={styles.controls}>
      <Pressable
        style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
        onPress={onCopy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="复制消息"
      >
        <Copy size={16} color={theme.color.text.tertiary} strokeWidth={2} />
      </Pressable>
      {onScrollToTop ? (
        <Pressable
          style={({ pressed }) => [styles.controlButton, pressed && styles.controlPressed]}
          onPress={onScrollToTop}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="将此消息滚动到顶部"
        >
          <ArrowUp size={16} color={theme.color.text.tertiary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  )
}

function MobileNativeChatMessageImpl({
  message,
  toolsExpanded = false,
  fontScale = 1,
  messageIndex,
  onScrollToMessage,
  onOpenFile,
  turnStatus,
  turnStatusAbove = false,
  turnExpanded,
  turnKey,
  onToggleTurn,
  activeTurnIsWorking,
  structuredActivityUi = false
}: {
  message: NativeChatMessage
  toolsExpanded?: boolean
  /** Multiplies all chat text sizes for pinch-to-zoom (1 = no change). */
  fontScale?: number
  messageIndex?: number
  onScrollToMessage?: (index: number) => void
  onOpenFile?: (relativePath: string) => void
  /** This turn's status row, rendered under its opening user message. */
  turnStatus?: NativeChatTurnStatus | null
  /** Render the status above the row: its turn has no user bubble of its own. */
  turnStatusAbove?: boolean
  /** Whether the turn caret has disclosed this turn's activity. */
  turnExpanded?: boolean
  /** Set only when this row's turn has settled and can disclose its activity. */
  turnKey?: string
  /** Stable across renders; the row supplies its own key when tapped. */
  onToggleTurn?: (turnKey: string) => void
  /** Session-level working state for this message's turn; gates the live tool row. */
  activeTurnIsWorking?: boolean
  /** Structured lane only: live tool progress plus the turn-status disclosure. */
  structuredActivityUi?: boolean
}): React.JSX.Element {
  const styles = useMobileThemeStyles(createMobileNativeChatMessageStyles)
  const clipboard = useClipboardWriter()
  const copyMessage = useCallback(() => {
    void clipboard.writeText(nativeChatMessageText(message.blocks)).catch(() => {})
  }, [clipboard, message])
  const isUser = message.role === 'user'
  const isReasoning = message.role === 'reasoning'
  // Separate the agent's words from its tool activity: prose renders first, the
  // tool calls fold into a collapsible run beneath. The user's own messages get
  // an inverted (filled accent) bubble so they stand apart from agent prose.
  const { prose, tools } = splitNativeChatBlocks(message.blocks)
  const activeCall = structuredActivityUi
    ? selectActiveToolCall(tools, { activeTurnIsWorking })
    : null
  // A completed turn's activity belongs behind the turn-status caret. Leaving the
  // grouped row visible made a failed child command read as a failed response.
  // The composer's global Tools toggle still overrides this, or it would silently
  // do nothing on every settled turn.
  const settledToolsHidden =
    structuredActivityUi &&
    activeCall == null &&
    activeTurnIsWorking === false &&
    !turnExpanded &&
    !toolsExpanded
  const showToolRun = tools.length > 0 && !settledToolsHidden

  const statusRow = turnStatus ? (
    <MobileNativeChatTurnStatus
      startedAt={turnStatus.startedAt}
      workedSeconds={turnStatus.workedSeconds}
      verdict={turnStatus.verdict}
      expanded={turnExpanded ?? false}
      onToggleExpanded={turnKey && onToggleTurn ? () => onToggleTurn(turnKey) : undefined}
    />
  ) : null
  return (
    <>
      {/* A turn with no user bubble carries its bar above its first row. */}
      {turnStatusAbove ? statusRow : null}
      <View style={[styles.row, isUser && styles.rowUser]}>
        <View
          style={[styles.content, isUser && styles.userBubble, isReasoning && styles.reasoning]}
        >
          {!isUser && prose.length > 0 ? (
            <AgentControls
              onCopy={copyMessage}
              onScrollToTop={
                messageIndex != null && onScrollToMessage
                  ? () => onScrollToMessage(messageIndex)
                  : undefined
              }
            />
          ) : null}
          {prose.map((block, index) => (
            <Prose
              key={index}
              block={block}
              invert={isUser}
              fontScale={fontScale}
              onOpenFile={onOpenFile}
            />
          ))}
          {showToolRun ? (
            <ToolRun
              // Why: a global toggle intentionally resets all per-run/per-line
              // overrides in one remount, avoiding an effect-driven second render.
              key={`${toolsExpanded ? 'expanded' : 'collapsed'}:${turnExpanded ? 'turn' : 'flat'}`}
              blocks={tools}
              defaultExpanded={turnExpanded || toolsExpanded}
              expandChildren={turnExpanded ? false : toolsExpanded}
              activeCall={activeCall}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </View>
      </View>
      {turnStatusAbove ? null : statusRow}
    </>
  )
}

export const MobileNativeChatMessage = memo(MobileNativeChatMessageImpl)
