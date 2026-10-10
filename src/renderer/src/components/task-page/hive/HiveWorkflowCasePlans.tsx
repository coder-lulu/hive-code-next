import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import type { WorkflowPlanDraft } from '../../../../../shared/task-workflow/workflow-plan-draft'
import { HiveWorkflowPlanProposalDetails } from './HiveWorkflowPlanProposalDetails'

function PlanSource({ draft }: { draft: WorkflowPlanDraft }) {
  const { t } = useTranslation()
  const fields = {
    draftRef: draft.draftRef,
    goalRef: draft.intent.facts.goalRef,
    taskRef: draft.producer.task.taskId,
    runRef: draft.producer.task.runId,
    attempt: draft.producer.task.attempt,
    taskRevision: draft.producer.task.taskRevision,
    outcomeRef: draft.outcomeVersion.artifactRef,
    outcomeRevision: draft.outcomeVersion.artifactRevision,
    outcomeDigest: draft.outcomeVersion.digest,
    inputDigest: draft.sourceInputDigest,
    ...(draft.artifact && {
      artifactRef: draft.artifact.artifactRef,
      artifactRevision: draft.artifact.artifactRevision,
      artifactDigest: draft.artifact.digest
    })
  }
  return (
    <details className="space-y-2">
      <summary className="cursor-pointer rounded-sm text-sm focus-visible:outline-ring">
        {t('hiveWorkflowCases.plans.source')}
      </summary>
      <dl className="space-y-2 text-xs">
        {Object.entries(fields).map(([key, value]) => (
          <div key={key}>
            <dt className="text-muted-foreground">{t(`hiveWorkflowCases.plans.${key}`)}</dt>
            <dd className="break-all font-mono">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

export function HiveWorkflowCasePlans({
  view
}: {
  view: Pick<HiveWorkflowCaseView, 'planDrafts'>
}) {
  const { t } = useTranslation()
  const heading = useId()
  return (
    <section className="min-w-0 space-y-3 border-t border-border pt-3" aria-labelledby={heading}>
      <h4 id={heading} className="text-sm font-medium">
        {t('hiveWorkflowCases.plans.title')}
      </h4>
      <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.plans.readonly')}</p>
      {!view.planDrafts.length && (
        <p className="text-sm text-muted-foreground">{t('hiveWorkflowCases.plans.empty')}</p>
      )}
      <ol className="divide-y divide-border">
        {view.planDrafts.map((draft) => (
          <li key={draft.draftRef} data-case-plan-draft className="min-w-0 space-y-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h5 className="text-sm font-medium">
                {t('hiveWorkflowCases.plans.revision', {
                  revision: draft.intent.facts.planRevision
                })}
              </h5>
              <Badge variant="secondary">
                {t(`hiveWorkflowCases.plans.states.${draft.inspection.kind}`)}
              </Badge>
            </div>
            {draft.inspection.kind === 'rejected' && (
              <div className="space-y-1 text-sm">
                <p>{t(`hiveWorkflowCases.plans.reasons.${draft.inspection.reason}`)}</p>
                {draft.inspection.taskRef && (
                  <p className="break-all">
                    {t('hiveWorkflowCases.plans.taskRef')}: {draft.inspection.taskRef}
                  </p>
                )}
              </div>
            )}
            {draft.inspection.kind === 'unavailable' && (
              <p className="text-sm">{t('hiveWorkflowCases.plans.missing')}</p>
            )}
            {draft.inspection.kind === 'validated' && (
              <HiveWorkflowPlanProposalDetails inspection={draft.inspection} />
            )}
            <PlanSource draft={draft} />
          </li>
        ))}
      </ol>
    </section>
  )
}
