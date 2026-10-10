import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDelayedStatus } from '@/hooks/use-delayed-status'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowPlanDraft } from '../../../../../shared/task-workflow/workflow-plan-draft'
import type { HiveWorkflowPlanApplicationView } from '../../../../../shared/hive-workflow-plan-application'
import { useHiveWorkflowPlanApplication } from './use-hive-workflow-plan-application'
import { HiveWorkflowPlanGraph } from './HiveWorkflowPlanGraph'

function PlanDifference({ page }: { page: HiveWorkflowPlanApplicationView }) {
  const { t } = useTranslation()
  const diff = page.diff
  if (!diff) {
    return null
  }
  return (
    <details className="space-y-2">
      <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-ring">
        {page.baseline
          ? t('hiveWorkflowCases.planApply.compare', {
              revision: page.baseline.intent.facts.planRevision
            })
          : t('hiveWorkflowCases.planApply.firstPlan')}
      </summary>
      <p className="text-xs text-muted-foreground">
        {t('hiveWorkflowCases.planApply.diffCounts', {
          added: diff.addedTaskRefs.length,
          removed: diff.removedTaskRefs.length,
          changed: diff.changedTasks.length
        })}
      </p>
      <ul className="space-y-2 text-xs">
        {diff.addedTaskRefs.map((ref) => (
          <li key={`added:${ref}`} className="break-all">
            {t('hiveWorkflowCases.planApply.added')}: {ref}
          </li>
        ))}
        {diff.removedTaskRefs.map((ref) => (
          <li key={`removed:${ref}`} className="break-all">
            {t('hiveWorkflowCases.planApply.removed')}: {ref}
          </li>
        ))}
        {diff.changedTasks.map((task) => (
          <li key={task.taskRef} className="break-all">
            {task.taskRef}:{' '}
            {task.fields
              .map((field) => t(`hiveWorkflowCases.planApply.fields.${field}`))
              .join(', ')}
          </li>
        ))}
        {diff.changedPlanFields.map((field) => (
          <li key={field}>{t(`hiveWorkflowCases.planApply.fields.${field}`)}</li>
        ))}
      </ul>
    </details>
  )
}

function AppliedTasks({
  page,
  view
}: {
  page: HiveWorkflowPlanApplicationView
  view: HiveWorkflowCaseView
}) {
  const { t } = useTranslation()
  const receipt = page.application
  if (!receipt) {
    return null
  }
  const source = view.planDrafts.find((item) => item.draftRef === receipt.draftRef)
  return (
    <div data-plan-application-receipt className="min-w-0 space-y-2">
      <p className="text-sm font-medium">
        {t('hiveWorkflowCases.planApply.created', {
          count: receipt.createdTaskRefs.length,
          revision: receipt.planRevision
        })}
      </p>
      <ol className="divide-y divide-border">
        {receipt.createdTaskRefs.map((task) => {
          const proposed =
            source?.inspection.kind === 'validated'
              ? source.inspection.proposal.tasks.find(
                  (item) => item.taskRef === task.proposalTaskRef
                )
              : undefined
          const state = page.taskStates.find((item) => item.taskId === task.taskId)
          return (
            <li key={task.taskId} data-plan-created-task className="space-y-1 py-2 text-xs">
              <p className="break-words">{proposed?.title ?? task.proposalTaskRef}</p>
              <div className="flex flex-wrap gap-2">
                {proposed && <span>{t(`hiveWorkflow.roles.${proposed.requestedRole}`)}</span>}
                {state && (
                  <Badge variant="secondary">
                    {t(`hiveWorkflowCases.statuses.${state.status}`)}
                  </Badge>
                )}
              </div>
              <p className="break-all font-mono">{task.taskId}</p>
              {!!task.dependsOnTaskIds.length && (
                <p className="break-all">
                  {t('hiveWorkflowCases.plans.dependencies')}: {task.dependsOnTaskIds.join(', ')}
                </p>
              )}
            </li>
          )
        })}
      </ol>
      <details className="text-xs">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-ring">
          {t('hiveWorkflowCases.planApply.receipt')}
        </summary>
        <dl className="space-y-2 pt-2">
          {Object.entries({
            applicationRef: receipt.applicationRef,
            requestId: receipt.requestId,
            draftDigest: receipt.draftDigest,
            appliedAt: receipt.appliedAt
          }).map(([field, value]) => (
            <div key={field}>
              <dt className="text-muted-foreground">{t(`hiveWorkflowCases.planApply.${field}`)}</dt>
              <dd className="break-all font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
      <HiveWorkflowPlanGraph key={receipt.applicationRef} original={view} application={receipt} />
    </div>
  )
}

function PlanApplication({
  view,
  draft
}: {
  view: HiveWorkflowCaseView
  draft: WorkflowPlanDraft
}) {
  const { t } = useTranslation()
  const model = useHiveWorkflowPlanApplication(view, draft)
  const page = model.page
  const pending = useDelayedStatus(`${view.id}:${draft.draftRef}`, model.pending, 200)
  const failure = model.error?.includes('FORBIDDEN')
    ? 'forbidden'
    : model.error?.includes('CAPABILITY_UNAVAILABLE')
      ? 'unsupported'
      : model.error?.includes('REVISION_CONFLICT')
        ? 'changed'
        : model.error?.includes('IDEMPOTENCY_CONFLICT')
          ? 'conflict'
          : 'unavailable'
  return (
    <div data-plan-application data-draft-ref={draft.draftRef} className="min-w-0 space-y-2 py-3">
      <p className="text-sm font-medium">
        {t('hiveWorkflowCases.plans.revision', { revision: draft.intent.facts.planRevision })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!model.ready || model.busy}
          onClick={() => void model.read()}
        >
          {t(page ? 'hiveWorkflowCases.planApply.refresh' : 'hiveWorkflowCases.planApply.inspect')}
        </Button>
        {page?.eligibility.available && (
          <Button
            size="sm"
            disabled={!model.ready || model.busy}
            onClick={() => void model.apply()}
          >
            {t('hiveWorkflowCases.planApply.apply')}
          </Button>
        )}
      </div>
      <p role="status" className="h-4 text-xs text-muted-foreground">
        {model.busy && pending ? t(`hiveWorkflowCases.planApply.pending.${pending}`) : ''}
      </p>
      {model.error && (
        <p role="alert" className="break-words text-sm text-destructive">
          {t(`hiveWorkflowCases.planApply.errors.${failure}`)}
        </p>
      )}
      {page && (
        <>
          <PlanDifference page={page} />
          {!page.eligibility.available && page.eligibility.reason !== 'already_applied' && (
            <p className="text-sm text-muted-foreground">
              {t(`hiveWorkflowCases.planApply.reasons.${page.eligibility.reason}`)}
            </p>
          )}
          <AppliedTasks page={page} view={view} />
        </>
      )}
    </div>
  )
}

export function HiveWorkflowPlanApplications({ view }: { view: HiveWorkflowCaseView }) {
  const { t } = useTranslation()
  const drafts = view.planDrafts.filter((draft) => draft.inspection.kind === 'validated')
  if (!drafts.length) {
    return null
  }
  return (
    <section
      className="min-w-0 space-y-2 border-t border-border pt-3"
      aria-label={t('hiveWorkflowCases.planApply.title')}
    >
      <h4 className="text-sm font-medium">{t('hiveWorkflowCases.planApply.title')}</h4>
      <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.planApply.help')}</p>
      <div className="divide-y divide-border">
        {drafts.map((draft) => (
          <PlanApplication key={`${view.id}:${draft.draftRef}`} view={view} draft={draft} />
        ))}
      </div>
    </section>
  )
}
