import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import { NativeChatMessageList } from '@/components/native-chat/NativeChatMessageList'
import { projectStructuredAgentSessionMessages } from '@/components/native-chat/structured-agent-session-message-projection'
import type { NativeChatLiveSession } from '@/components/native-chat/native-chat-live-session-contract'
import type { HiveWorkflowCaseSessionRead } from '../../../../../shared/hive-workflow-case-session'
import { useHiveWorkflowCaseSession } from './use-hive-workflow-case-session'
import { workflowCaseSessionKey } from './hive-workflow-case-session-responses'

export function HiveWorkflowCaseSession({
  query,
  onClose,
  onBusyChange
}: {
  query: HiveWorkflowCaseSessionRead
  onClose: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const model = useHiveWorkflowCaseSession(query)
  const pending = useDelayedStatus(workflowCaseSessionKey(query), model.pending, 200)
  const messages = useMemo(
    () =>
      projectStructuredAgentSessionMessages(model.timeline.items, [], model.timeline.submissions),
    [model.timeline.items, model.timeline.submissions]
  )
  const error = model.error?.includes('FORBIDDEN')
    ? 'forbidden'
    : model.error?.includes('INVALID_RESPONSE')
      ? 'invalidResponse'
      : model.error?.includes('UNSUPPORTED') || model.error?.includes('CAPABILITY_UNAVAILABLE')
        ? 'unsupported'
        : 'unavailable'
  const session: NativeChatLiveSession = {
    sessionId: model.original?.sessionId ?? null,
    agent: 'codex',
    messages,
    status: model.error
      ? 'error'
      : !model.original
        ? 'loading'
        : messages.length
          ? 'ready'
          : 'empty',
    hasMore: model.timeline.hasOlder,
    loadingEarlier: model.pending === 'before',
    olderHistoryGeneration: model.historyGeneration,
    loadEarlier: model.loadEarlier,
    readPhase: model.error ? 'error' : model.original ? 'ready' : 'loading'
  }
  useEffect(() => {
    onBusyChange(model.busy)
    return () => onBusyChange(false)
  }, [model.busy, onBusyChange])
  return (
    <section
      data-case-session-reader
      className="space-y-3 border-t border-border pt-3"
      aria-labelledby="hive-case-session-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id="hive-case-session-heading" className="text-sm font-medium">
          {t('hiveWorkflowCases.session.title')}
        </h4>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!model.ready || model.busy}
            onClick={() => {
              void model.refresh()
            }}
          >
            <RefreshCw />
            {t('hiveWorkflowCases.session.refresh')}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            {t('hiveWorkflowCases.session.close')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('hiveWorkflowCases.session.description')}</p>
      <div
        className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t('hiveWorkflowCases.session.loading')}</span>
          </>
        )}
      </div>
      {model.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(`hiveWorkflowCases.session.errors.${error}`)}
        </p>
      )}
      {model.limited && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.session.limit')}
        </p>
      )}
      {model.historyReset && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.session.historyReset')}
        </p>
      )}
      {model.original && (
        <>
          {!model.timeline.items.length && (
            <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.session.empty')}</p>
          )}
          <div className="flex h-96 min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
            <NativeChatMessageList
              session={session}
              journalItems={model.timeline.items}
              journalSubmissions={model.timeline.submissions}
              subagentRoster={model.timeline.subagentRoster}
              isWorking={false}
              expandSignal={false}
              allowFileUriLinks={false}
            />
          </div>
        </>
      )}
    </section>
  )
}
