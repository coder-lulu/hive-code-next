import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { HiveWorkflowCaseRunsModel } from './use-hive-workflow-case-runs'
import { workflowCaseRunIsActive } from './hive-workflow-case-run-responses'

export function HiveWorkflowCaseRuns({
  view,
  model,
  scopeLabel
}: {
  view: HiveWorkflowCaseView
  model: HiveWorkflowCaseRunsModel
  scopeLabel: string
}) {
  const { t } = useTranslation()
  const pending = useDelayedStatus(view.id, model.pending, 200)
  const errorKey = model.error?.includes('FORBIDDEN')
    ? 'forbidden'
    : model.error?.includes('CONFLICT')
      ? 'conflict'
      : model.error?.includes('INVALID_RESPONSE')
        ? 'invalidResponse'
        : 'unavailable'
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-labelledby="hive-case-runs-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h4 id="hive-case-runs-heading" className="text-sm font-medium">
            {t('hiveWorkflowCases.execution.title', { defaultValue: '阶段执行' })}
          </h4>
          <p className="break-words text-xs text-muted-foreground">{scopeLabel}</p>
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.execution.scope', {
              defaultValue: '启动产品阶段后，团队自动交接开发、独立测试和发布准备。'
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={model.busy}
            onClick={() => {
              void model.refresh()
            }}
          >
            <RefreshCw />
            {t('hiveTasks.refresh')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={model.busy || !model.canStart}
            onClick={() => {
              void model.start()
            }}
          >
            {model.resumable
              ? t('hiveWorkflowCases.execution.resume', { defaultValue: '恢复当前阶段' })
              : t('hiveWorkflowCases.execution.start', { defaultValue: '启动当前阶段' })}
          </Button>
        </div>
      </div>
      {!view.executionAvailability.available && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.executionUnavailable')}
        </p>
      )}
      {model.uncertain && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('hiveWorkflowCases.execution.uncertain', {
            defaultValue: '启动结果尚未确认。重试启动会复用同一请求，继续刷新可查看运行状态。'
          })}
        </p>
      )}
      <div
        className="flex h-6 items-center gap-2 text-xs text-muted-foreground"
        role="status"
        aria-live="polite"
      >
        {pending && (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t('hiveTasks.working')}</span>
          </>
        )}
      </div>
      {model.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(`hiveWorkflowCases.errors.${errorKey}`)}
        </p>
      )}
      {model.loaded && !model.runs.length && !model.uncertain && (
        <p className="text-sm text-muted-foreground">
          {t('hiveWorkflowCases.execution.empty', { defaultValue: '当前需求还没有阶段运行。' })}
        </p>
      )}
      <ol className="divide-y divide-border">
        {model.runs.map((run) => (
          <li key={run.task.runId} data-case-stage-run className="space-y-2 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="break-words text-sm font-medium">
                  {t(`hiveWorkflow.roles.${run.role}`)}
                </p>
                <p className="break-words text-xs text-muted-foreground">{run.title}</p>
                <p className="text-xs text-muted-foreground">
                  {t('hiveWorkflowCases.execution.attempt', { attempt: run.task.attempt })}
                </p>
              </div>
              <Badge variant="secondary">{t(`hiveTasks.status.${run.status}`)}</Badge>
            </div>
            {(run.status === 'unknown' || run.status === 'cancelRequested') && (
              <p className="text-xs text-muted-foreground">{t('hiveTasks.unknownHelp')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {run.artifactRefs.map((ref, index) => (
                <Button
                  key={ref}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={model.busy}
                  onClick={() => {
                    void model.readArtifact(run, ref)
                  }}
                >
                  {t('hiveTasks.artifact', { number: index + 1 })}
                </Button>
              ))}
              {workflowCaseRunIsActive(run) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={model.busy}
                  onClick={() => {
                    void model.cancel(run)
                  }}
                >
                  {t('hiveTasks.cancel')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {model.artifact && (
        <section className="space-y-2 border-t border-border pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="min-w-0 break-words text-sm font-medium">{model.artifact.name}</h4>
            <Button type="button" size="sm" variant="ghost" onClick={model.clearArtifact}>
              {t('hiveTasks.closeArtifact')}
            </Button>
          </div>
          <Textarea
            readOnly
            variant="code"
            rows={8}
            className="max-h-80"
            aria-label={model.artifact.name}
            value={model.artifact.text}
          />
          {model.artifact.truncated && (
            <p className="text-xs text-muted-foreground">
              {t('hiveWorkflowCases.execution.artifactTruncated', {
                defaultValue: '预览仅显示前 262,144 个字符。'
              })}
            </p>
          )}
        </section>
      )}
    </section>
  )
}
