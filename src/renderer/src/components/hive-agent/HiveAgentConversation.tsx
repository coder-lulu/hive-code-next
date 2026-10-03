import { useMemo } from 'react'
import { NativeChatMessageList } from '../native-chat/NativeChatMessageList'
import { projectStructuredItemsToNativeChat } from '../../../../shared/structured-agent-session-projection'
import { translate } from '@/i18n/i18n'
import { useHiveAgentConversation } from './use-hive-agent-conversation'

export const hiveChatCopy = (key: string, fallback: string) =>
  translate(`hiveAgentChat.${key}`, fallback)

/** Read-only compatibility for pre-native Pi conversations. */
export function HiveAgentConversation(props: {
  tabId: string
  accountId: string
  projectSelector: string
  sessionId: string
}) {
  const chat = useHiveAgentConversation(props.accountId, props.projectSelector, props.sessionId)
  const messages = useMemo(
    () => projectStructuredItemsToNativeChat(chat.timeline.items),
    [chat.timeline.items]
  )
  const ready = chat.timeline.status === 'ready'
  return (
    <section className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <p className="p-3 text-sm text-muted-foreground">
        {hiveChatCopy(
          'legacyHistory',
          'This conversation is read-only history. Start a new HiveCode AI session to use native Pi.'
        )}
      </p>
      {chat.error && (
        <p role="alert" className="p-3 text-sm text-destructive">
          {hiveChatCopy(
            'unavailable',
            'Conversation unavailable. Check your sign-in, device ownership and AI account.'
          )}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <NativeChatMessageList
          session={{
            sessionId: props.sessionId,
            agent: 'hivecode',
            messages,
            status: ready ? 'ready' : 'loading',
            hasMore: chat.timeline.hasOlder,
            loadingEarlier: chat.loadingEarlier,
            olderHistoryGeneration: chat.olderHistoryGeneration,
            loadEarlier: chat.loadEarlier,
            readPhase: ready ? 'ready' : 'loading'
          }}
          journalItems={chat.timeline.items}
          isWorking={false}
          expandSignal={false}
          fontScale={1}
        />
      </div>
    </section>
  )
}
