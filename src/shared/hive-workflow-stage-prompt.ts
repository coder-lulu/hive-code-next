import type { HiveWorkflowCaseView } from './hive-workflow-cases'

const ROLE_INSTRUCTIONS = {
  product:
    'Produce requirements.md with the requested behavior, constraints and explicit acceptance checks.',
  developer:
    'Implement the feature in this managed workspace. Produce implementation.md describing changes and verification.',
  tester:
    'Independently test the supplied immutable code version. Produce test-report.md with actual commands, results and a review decision.',
  ops: 'Produce release-plan.md with prerequisites, release checks and rollback steps. Deployment requires separate explicit owner approval.'
}

/** Role instructions supplement the complete requirement; they never grant host or deployment authority. */
export function hiveWorkflowStagePrompt(view: HiveWorkflowCaseView, stageRef: string) {
  const stage = view.workflow.definition.stages.find((candidate) => candidate.stageRef === stageRef)
  if (!stage) {
    throw new Error('REVISION_CONFLICT')
  }
  return [
    `Workflow case: ${view.id}\nFixed stage: ${stage.stageRef}\nRole: ${stage.role}`,
    ROLE_INSTRUCTIONS[stage.role],
    'Use only this isolated workspace and the supplied task inputs. Do not deploy, access host credentials, or start detached processes.',
    `User requirement:\n${view.requirement}`,
    `Acceptance criteria:\n${stage.acceptanceCriteria.join('\n')}`
  ].join('\n\n')
}
