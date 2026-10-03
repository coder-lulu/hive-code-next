import { useHiveAccountState } from '@/hooks/use-hive-account-state'
import { HiveAgentConversation, hiveChatCopy } from './HiveAgentConversation'

export function HiveAgentTaskPane(props: { tabId: string; sessionId: string; worktreeId: string }) {
  const { state } = useHiveAccountState()
  if (state?.status !== 'signed-in' || state.errorCode || !state.account) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        {hiveChatCopy('signIn', 'Sign in to your Hive account to use AI conversations.')}
      </p>
    )
  }
  return (
    <HiveAgentConversation
      key={`${state.account.accountId}:${props.sessionId}`}
      tabId={props.tabId}
      accountId={state.account.accountId}
      projectSelector={props.worktreeId}
      sessionId={props.sessionId}
    />
  )
}
