import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowCaseRuns } from './HiveWorkflowCaseRuns'
import type { HiveWorkflowCaseRunsModel } from './use-hive-workflow-case-runs'

export function HiveWorkflowCaseDetail({
  view,
  runs,
  scopeLabel
}: {
  view: HiveWorkflowCaseView
  runs: HiveWorkflowCaseRunsModel
  scopeLabel: string
}) {
  const { t } = useTranslation()
  const stages = view.workflow.definition.stages
  const currentIndex = stages.findIndex((stage) => stage.stageRef === view.currentStageRef)
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-labelledby="hive-workflow-case-detail-heading"
    >
      <div className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3
            id="hive-workflow-case-detail-heading"
            className="min-w-0 break-words text-sm font-medium"
          >
            {view.title}
          </h3>
          <Badge variant="secondary">
            {t(`hiveWorkflowCases.caseStatuses.${view.terminalKind ?? 'open'}`)}
          </Badge>
        </div>
        <p data-case-fixed-version className="text-xs text-muted-foreground">
          {t('hiveWorkflowCases.fixedVersion', {
            name: view.workflow.name,
            revision: view.binding.workflowRevision
          })}
        </p>
        {currentIndex !== -1 && (
          <p className="text-xs text-muted-foreground">
            {t('hiveWorkflowCases.currentStage', {
              stage: t('hiveWorkflow.stageLabel', {
                index: currentIndex + 1,
                role: t(`hiveWorkflow.roles.${stages[currentIndex].role}`)
              })
            })}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('hiveWorkflowCases.requirementBody')}</h4>
        <p className="break-words whitespace-pre-wrap text-sm">{view.requirement}</p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{t('hiveWorkflowCases.assignedStages')}</h4>
        <ol className="divide-y divide-border">
          {stages.map((stage, index) => {
            const task = view.stageTasks.find((candidate) => candidate.stageRef === stage.stageRef)
            if (!task) {
              return null
            }
            return (
              <li key={task.taskId} data-workflow-stage-task className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-medium">
                    {t('hiveWorkflow.stageLabel', {
                      index: index + 1,
                      role: t(`hiveWorkflow.roles.${task.role}`)
                    })}
                  </p>
                  <Badge variant="secondary">
                    {t(`hiveWorkflowCases.statuses.${task.status}`)}
                  </Badge>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {stage.acceptanceCriteria.map((criterion, criterionIndex) => (
                    <li key={criterionIndex} className="break-words whitespace-pre-wrap">
                      {criterion}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ol>
      </div>
      <HiveWorkflowCaseRuns view={view} model={runs} scopeLabel={scopeLabel} />
    </section>
  )
}
