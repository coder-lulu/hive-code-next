import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowHandoff } from '../../../../../shared/task-workflow/workflow-evidence'
import type { HiveWorkflowCaseRunsModel } from './use-hive-workflow-case-runs'

type RoleExecution = WorkflowHandoff['producer']

function evidenceRun(
  view: HiveWorkflowCaseView,
  model: HiveWorkflowCaseRunsModel,
  stageRef: string,
  execution: RoleExecution
) {
  if (!model.loaded) {
    return undefined
  }
  const task = view.stageTasks.find((item) => item.stageRef === stageRef)
  const matches = model.runs.filter(
    (run) =>
      run.caseId === view.id &&
      run.startRequest.caseId === view.id &&
      run.startRequest.projectId === view.binding.scope.projectRef &&
      run.stageRef === stageRef &&
      run.startRequest.stageRef === stageRef &&
      run.role === execution.role &&
      run.role === task?.role &&
      run.employeeRef === execution.employeeRef &&
      run.employeeRef === task?.employeeRef &&
      run.task.spaceId === view.binding.scope.companyRef &&
      run.task.taskId === task?.taskId &&
      run.task.spaceId === execution.task.spaceId &&
      run.task.taskId === execution.task.taskId &&
      run.task.runId === execution.task.runId &&
      run.task.attempt === execution.task.attempt &&
      run.task.taskRevision === execution.task.taskRevision
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function HiveWorkflowCaseEvidence({
  view,
  model
}: {
  view: HiveWorkflowCaseView
  model: HiveWorkflowCaseRunsModel
}) {
  const { t } = useTranslation()
  const reportButton = (stageRef: string, execution: RoleExecution, ref: string) => {
    const run = evidenceRun(view, model, stageRef, execution)
    const available = Boolean(run?.artifactRefs.includes(ref))
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={t('hiveWorkflowCases.evidence.readRoleReport', {
            role: t(`hiveWorkflow.roles.${execution.role}`),
            attempt: execution.task.attempt
          })}
          disabled={model.busy || !available}
          onClick={() => {
            if (run && available) {
              void model.readArtifact(run, ref)
            }
          }}
        >
          {t('hiveWorkflowCases.evidence.readReport')}
        </Button>
        {!available && (
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.evidence.reportUnavailable')}
          </p>
        )}
      </div>
    )
  }
  const executionMetadata = (stageRef: string, execution: RoleExecution) => {
    const run = evidenceRun(view, model, stageRef, execution)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.execution.attempt', { attempt: execution.task.attempt })}
        </p>
        <Badge variant="secondary">
          {run
            ? t(`hiveTasks.status.${run.status}`)
            : t('hiveWorkflowCases.evidence.runUnavailable')}
        </Badge>
      </div>
    )
  }
  const codeVersion = (version: NonNullable<WorkflowHandoff['codeVersion']>) => (
    <p className="break-all text-xs text-muted-foreground">
      {t('hiveWorkflowCases.evidence.codeVersion', { version: version.treeDigest })}
    </p>
  )
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-labelledby="hive-case-evidence-heading"
    >
      <h4 id="hive-case-evidence-heading" className="text-sm font-medium">
        {t('hiveWorkflowCases.evidence.title')}
      </h4>
      {!view.handoffs.length && !view.reviews.length && (
        <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.evidence.empty')}</p>
      )}
      <ol className="divide-y divide-border" aria-label={t('hiveWorkflowCases.evidence.handoffs')}>
        {view.handoffs.map((handoff) => (
          <li key={handoff.handoffRef} data-case-handoff className="space-y-2 py-3">
            <p className="text-sm font-medium">
              {t('hiveWorkflowCases.evidence.handoff', {
                producer: t(`hiveWorkflow.roles.${handoff.producer.role}`),
                consumer: t(`hiveWorkflow.roles.${handoff.consumer.role}`)
              })}
            </p>
            {executionMetadata(handoff.stageRef, handoff.producer)}
            {handoff.codeVersion && codeVersion(handoff.codeVersion)}
            <p className="scrollbar-sleek max-h-40 overflow-y-auto break-words whitespace-pre-wrap text-sm">
              {handoff.summary}
            </p>
            {reportButton(handoff.stageRef, handoff.producer, handoff.artifact.artifactRef)}
          </li>
        ))}
      </ol>
      <ol className="divide-y divide-border" aria-label={t('hiveWorkflowCases.evidence.reviews')}>
        {view.reviews.map((review) => {
          const report = view.handoffs.find(
            (handoff) =>
              handoff.stageRef === review.stageRef &&
              handoff.producer.task.runId === review.reviewer.task.runId &&
              handoff.artifact.artifactRef === review.testReport.artifactRef
          )
          return (
            <li key={review.reviewRef} data-case-review className="space-y-2 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-medium">{t('hiveWorkflowCases.evidence.review')}</p>
                <Badge variant="secondary">
                  {t(`hiveWorkflowCases.evidence.decisions.${review.decision}`)}
                </Badge>
              </div>
              {executionMetadata(review.stageRef, review.reviewer)}
              {codeVersion(review.codeVersion)}
              {report && (
                <p className="scrollbar-sleek max-h-40 overflow-y-auto break-words whitespace-pre-wrap text-sm">
                  {report.summary}
                </p>
              )}
              {reportButton(review.stageRef, review.reviewer, review.testReport.artifactRef)}
            </li>
          )
        })}
      </ol>
      {view.executionNotices.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">{t('hiveWorkflowCases.evidence.notices')}</h4>
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.evidence.noticesHelp')}
          </p>
          <ol className="divide-y divide-border">
            {view.executionNotices.map((notice) => {
              const task = view.stageTasks.find((item) => item.stageRef === notice.stageRef)
              return (
                <li key={notice.eventRef} data-case-execution-notice className="space-y-1 py-3">
                  <p className="break-words text-sm">
                    {t('hiveWorkflowCases.evidence.notice', {
                      role: task
                        ? t(`hiveWorkflow.roles.${task.role}`)
                        : t('hiveWorkflow.unknownStage'),
                      reason: t(`hiveWorkflowCases.evidence.reasons.${notice.reason}`)
                    })}
                  </p>
                  <time
                    className="break-words text-xs text-muted-foreground"
                    dateTime={notice.recordedAt}
                  >
                    {new Date(notice.recordedAt).toLocaleString()}
                  </time>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}
