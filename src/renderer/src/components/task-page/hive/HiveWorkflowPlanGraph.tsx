import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowPlanApplicationReceipt } from '../../../../../shared/hive-workflow-plan-application'
import { useHiveWorkflowPlanGraph } from './use-hive-workflow-plan-graph'
import { workflowPlanGraphCanResume } from './hive-workflow-plan-graph-responses'

export function HiveWorkflowPlanGraph({
  original,
  application
}: {
  original: HiveWorkflowCaseView
  application: HiveWorkflowPlanApplicationReceipt
}) {
  const { t } = useTranslation()
  const model = useHiveWorkflowPlanGraph(original, application)
  const page = model.page,
    graph = page?.graph
  const pending = useDelayedStatus(application.applicationRef, model.pending, 200)
  const failure = model.error?.includes('FORBIDDEN')
    ? 'forbidden'
    : model.error?.includes('CAPABILITY_UNAVAILABLE')
      ? 'unsupported'
      : model.error?.includes('REVISION_CONFLICT')
        ? 'changed'
        : model.error?.includes('IDEMPOTENCY_CONFLICT')
          ? 'conflict'
          : 'unavailable'
  const proposed =
    page?.draft.inspection.kind === 'validated' ? page.draft.inspection.proposal : null
  return (
    <section
      data-plan-graph
      className="min-w-0 space-y-2 border-t border-border pt-3"
      aria-label={t('hiveWorkflowCases.planGraph.title')}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h5 className="text-sm font-medium">{t('hiveWorkflowCases.planGraph.title')}</h5>
        {graph && (
          <Badge variant="secondary">
            {t(`hiveWorkflowCases.planGraph.states.${graph.status}`)}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.planGraph.help')}</p>
      {proposed && (
        <p className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.planGraph.limits', {
            parallel: graph?.maxParallelism ?? proposed.requestedLimits.maxParallelism,
            seconds: (graph?.maxDurationMs ?? proposed.requestedLimits.maxDurationMs) / 1000
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!graph && page?.availability.available && (
          <Button
            size="sm"
            disabled={!model.ready || model.busy}
            onClick={() => void model.start()}
          >
            {t('hiveWorkflowCases.planGraph.start')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!model.ready || model.busy}
          onClick={() => void model.read()}
        >
          {t('hiveWorkflowCases.planApply.refresh')}
        </Button>
        {graph && ['running', 'paused'].includes(graph.status) && (
          <Button
            size="sm"
            variant="ghost"
            disabled={!model.ready || model.busy}
            onClick={() => void model.cancel()}
          >
            {t('hiveWorkflowCases.planGraph.cancel')}
          </Button>
        )}
        {page && workflowPlanGraphCanResume(page) && (
          <Button
            size="sm"
            disabled={!model.ready || model.busy}
            onClick={() => void model.resume()}
          >
            {t('hiveWorkflowCases.planGraph.resume')}
          </Button>
        )}
      </div>
      <p role="status" className="h-4 text-xs text-muted-foreground">
        {model.busy && pending ? t(`hiveWorkflowCases.planGraph.pending.${pending}`) : ''}
      </p>
      {model.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(`hiveWorkflowCases.planGraph.errors.${failure}`)}
        </p>
      )}
      {page &&
        !page.availability.available &&
        !(
          graph?.status === 'cancel_requested' && page.availability.reason === 'graph_cancelled'
        ) && (
          <p className="text-sm text-muted-foreground">
            {t(`hiveWorkflowCases.planGraph.reasons.${page.availability.reason}`)}
          </p>
        )}
      {graph?.pauseCause && (
        <p className="text-sm text-muted-foreground">
          {t(`hiveWorkflowCases.planGraph.reasons.${graph.pauseCause.reason}`)}
        </p>
      )}
      {page && (
        <ol className="divide-y divide-border">
          {page.tasks.map((task) => {
            const planned = proposed?.tasks.find((item) => item.taskRef === task.proposalTaskRef)
            const outcome = page.outcomes.find(
              (item) => item.producer.task.runId === task.latestRun?.runId
            )
            const run = page.runs.find((item) => item.task.runId === task.latestRun?.runId)
            const retry =
              graph?.status === 'paused' &&
              task.blockedReason === 'failed' &&
              task.latestRun &&
              task.latestRun.attempt < task.maxAttempts
            return (
              <li
                key={task.taskId}
                data-plan-graph-task={task.taskId}
                className="min-w-0 space-y-1 py-2 text-xs"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 break-words">{planned?.title ?? task.proposalTaskRef}</p>
                  <Badge variant="secondary">
                    {t(`hiveWorkflowCases.statuses.${task.status}`)}
                  </Badge>
                </div>
                <p>
                  {t(`hiveWorkflow.roles.${task.role}`)} ·{' '}
                  {t('hiveWorkflowCases.planGraph.attempts', {
                    current: task.latestRun?.attempt ?? 0,
                    max: task.maxAttempts
                  })}
                </p>
                {run && (
                  <p className="text-muted-foreground">
                    {t('hiveWorkflowCases.planGraph.runState', {
                      state: t(`hiveTasks.status.${run.status}`)
                    })}
                  </p>
                )}
                {task.blockedReason && (
                  <p className="text-muted-foreground">
                    {t(`hiveWorkflowCases.planGraph.blocked.${task.blockedReason}`)}
                  </p>
                )}
                {outcome && <p className="break-words whitespace-pre-wrap">{outcome.summary}</p>}
                {outcome && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!model.ready || model.busy}
                    onClick={() => void model.readReport(outcome)}
                  >
                    {t('hiveWorkflowCases.planGraph.report')}
                  </Button>
                )}
                {model.report?.taskId === task.taskId &&
                  model.report.runId === task.latestRun?.runId &&
                  model.report.outcomeRef === outcome?.outcomeRef &&
                  model.report.artifactRef === outcome?.reportVersion.artifactRef && (
                    <div className="space-y-1">
                      <p className="font-medium">{model.report.name}</p>
                      <pre className="break-words whitespace-pre-wrap font-mono">
                        {model.report.text}
                      </pre>
                      {model.report.truncated && (
                        <p className="text-muted-foreground">
                          {t('hiveWorkflowCases.planGraph.reportTruncated')}
                        </p>
                      )}
                    </div>
                  )}
                {outcome?.review && (
                  <p>{t(`hiveWorkflowCases.planGraph.reviews.${outcome.review.decision}`)}</p>
                )}
                {retry && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!model.ready || model.busy}
                    onClick={() => void model.retry(task)}
                  >
                    {t('hiveWorkflowCases.planGraph.retry')}
                  </Button>
                )}
                <details>
                  <summary className="cursor-pointer rounded-sm focus-visible:outline-ring">
                    {t('hiveWorkflowCases.planGraph.identity')}
                  </summary>
                  <p className="break-all pt-1 font-mono">{task.taskId}</p>
                  {task.latestRun && <p className="break-all font-mono">{task.latestRun.runId}</p>}
                </details>
              </li>
            )
          })}
        </ol>
      )}
      {graph && (
        <p className="break-words text-xs text-muted-foreground">
          {t('hiveWorkflowCases.planGraph.deadline', {
            at: new Date(graph.deadlineAt).toLocaleString()
          })}
        </p>
      )}
    </section>
  )
}
