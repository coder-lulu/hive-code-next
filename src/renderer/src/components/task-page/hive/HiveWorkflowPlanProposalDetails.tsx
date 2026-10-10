import { useTranslation } from 'react-i18next'
import type { WorkflowPlanDraft } from '../../../../../shared/task-workflow/workflow-plan-draft'

type Inspection = Extract<WorkflowPlanDraft['inspection'], { kind: 'validated' }>

function criteriaEntries(criteria: readonly string[]) {
  const occurrences = new Map<string, number>()
  return criteria.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1
    occurrences.set(text, occurrence)
    return { text, key: JSON.stringify([text, occurrence]) }
  })
}

export function HiveWorkflowPlanProposalDetails({ inspection }: { inspection: Inspection }) {
  const { t } = useTranslation()
  const { proposal, capabilityGaps } = inspection
  return (
    <div className="min-w-0 space-y-3 text-sm">
      <div className="space-y-1">
        <h6 className="font-medium">{t('hiveWorkflowCases.plans.gaps')}</h6>
        <ul className="space-y-1">
          {capabilityGaps.map((gap) => (
            <li
              key={`${gap.capability}:${gap.sourceRef ?? ''}`}
              data-plan-capability-gap
              className="break-all"
            >
              {t(`hiveWorkflowCases.plans.capabilities.${gap.capability}`)}
              {' — '}
              {t(`hiveWorkflowCases.plans.${gap.blocking ? 'blocking' : 'optional'}`)}
              {gap.sourceRef && `: ${gap.sourceRef}`}
            </li>
          ))}
        </ul>
      </div>
      <details className="space-y-2">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-ring">
          {t('hiveWorkflowCases.plans.tasks', { count: proposal.tasks.length })}
        </summary>
        <ol className="divide-y divide-border">
          {proposal.tasks.map((task) => (
            <li key={task.taskRef} data-plan-task className="space-y-2 break-words py-3">
              <p className="font-medium [overflow-wrap:anywhere]">{task.title}</p>
              <p>{t(`hiveWorkflow.roles.${task.requestedRole}`)}</p>
              <p className="break-all text-xs text-muted-foreground">
                {t('hiveWorkflowCases.plans.taskRef')}: {task.taskRef}
              </p>
              <p className="break-all">
                {t('hiveWorkflowCases.plans.dependencies')}:{' '}
                {task.dependsOn.length
                  ? task.dependsOn.join(', ')
                  : t('hiveWorkflowCases.plans.none')}
              </p>
              <p>{t('hiveWorkflowCases.plans.attemptLimit', { count: task.maxAttempts })}</p>
              <p>{t('hiveWorkflowCases.plans.acceptance')}</p>
              <ul className="list-inside list-disc space-y-1 [overflow-wrap:anywhere]">
                {criteriaEntries(task.acceptance).map((criterion) => (
                  <li key={criterion.key}>{criterion.text}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </details>
      <details className="space-y-2">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-ring">
          {t('hiveWorkflowCases.plans.requests')}
        </summary>
        <p className="text-xs text-muted-foreground">{t('hiveWorkflowCases.plans.requestsHelp')}</p>
        <p>
          {t('hiveWorkflowCases.plans.parallelism', {
            count: proposal.requestedLimits.maxParallelism
          })}
        </p>
        <p>
          {t('hiveWorkflowCases.plans.duration', {
            milliseconds: proposal.requestedLimits.maxDurationMs
          })}
        </p>
        {proposal.requestedLimits.budget && (
          <p>{t('hiveWorkflowCases.plans.budget', proposal.requestedLimits.budget)}</p>
        )}
        {proposal.resourceSelectionRefs && (
          <div className="space-y-1">
            <p>{t('hiveWorkflowCases.plans.resources')}</p>
            <ul className="space-y-1 break-all">
              {proposal.resourceSelectionRefs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
            <p className="break-all">
              {t('hiveWorkflowCases.plans.coverage')}: {proposal.requiredCoverage}
            </p>
          </div>
        )}
        {proposal.knowledgeRequirements && (
          <div className="space-y-1">
            <p>{t('hiveWorkflowCases.plans.knowledge')}</p>
            <ul className="space-y-1 break-all">
              {proposal.knowledgeRequirements.map((source) => (
                <li key={source.sourceRef}>
                  {source.sourceRef}:{' '}
                  {t(`hiveWorkflowCases.plans.${source.required ? 'required' : 'optional'}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </details>
    </div>
  )
}
