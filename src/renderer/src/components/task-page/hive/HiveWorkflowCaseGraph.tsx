import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HiveWorkflowCaseView } from '../../../../../shared/hive-workflow-cases'
import { HiveWorkflowGraph } from './HiveWorkflowGraph'

export function HiveWorkflowCaseGraph({ view }: { view: HiveWorkflowCaseView }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  const stages = view.workflow.definition.stages
  const stage =
    stages.find((candidate) => candidate.stageRef === selected) ??
    stages.find((candidate) => candidate.stageRef === view.currentStageRef) ??
    stages[0]
  const index = stages.findIndex((candidate) => candidate.stageRef === stage?.stageRef)
  return (
    <section
      data-case-workflow-graph
      aria-label={t('hiveWorkflowCases.assignedStages')}
      className="min-w-0 space-y-3"
    >
      <HiveWorkflowGraph
        stages={stages}
        selected={stage?.stageRef ?? null}
        disabled={false}
        onSelect={setSelected}
        caseFacts={{ currentStageRef: view.currentStageRef, stageTasks: view.stageTasks }}
      />
      {stage && (
        <div data-case-stage-criteria className="space-y-2 border-t border-border pt-3">
          <h4 className="text-sm font-medium">
            {t('hiveWorkflow.stageLabel', {
              index: index + 1,
              role: t(`hiveWorkflow.roles.${stage.role}`)
            })}
            {' · '}
            {t('hiveWorkflow.acceptanceCriteria')}
          </h4>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {stage.acceptanceCriteria.map((criterion, criterionIndex) => (
              <li key={criterionIndex} className="break-words whitespace-pre-wrap">
                {criterion}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
