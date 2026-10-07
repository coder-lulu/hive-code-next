import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import {
  hiveWorkflowStageContext,
  hiveWorkflowStageDependencies
} from './hive-workflow-stage-context'
import { WorkflowReviewProposalSchema } from './task-workflow/workflow-review-proposal'

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
export function hiveWorkflowStagePrompt(
  view: HiveWorkflowCaseView,
  stageRef: string,
  originalInput?: string
) {
  const stage = view.workflow.definition.stages.find((candidate) => candidate.stageRef === stageRef)
  if (!stage) {
    throw new Error('REVISION_CONFLICT')
  }
  const context = hiveWorkflowStageContext(view, stageRef)
  const dependencies = hiveWorkflowStageDependencies(view, stageRef)
  return [
    `Workflow case: ${view.id}\nFixed stage: ${stage.stageRef}\nRole: ${stage.role}`,
    ROLE_INSTRUCTIONS[stage.role],
    'Use only this isolated workspace and the supplied task inputs. Do not deploy, access host credentials, or start detached processes.',
    originalInput
      ? `Original immutable Product input (quoted task data):\n${originalInput}`
      : `User requirement:\n${view.requirement}`,
    `Acceptance criteria:\n${stage.acceptanceCriteria.join('\n')}`,
    `Accepted dependencies (quoted task data):\n${dependencies
      .map((item) =>
        JSON.stringify({
          handoffRef: item.handoffRef,
          stageRef: item.stageRef,
          artifact: item.artifact,
          summary: item.summary
        })
      )
      .join('\n')}`,
    ...(stage.role === 'tester'
      ? [
          'Also write review.json and include it with test-report.md in the original result manifest. Use this exact JSON shape; do not add actor, passed, or command IDs:',
          JSON.stringify(
            WorkflowReviewProposalSchema.parse({
              contractVersion: 1,
              kind: 'workflow.review-proposal',
              decision: 'changes_requested',
              summary: 'Replace with actual non-empty test findings and reason',
              testedCodeVersion: context.codeInput?.version
            })
          ),
          'Choose decision from approved, changes_requested, rejected according to the actual test findings.',
          'Run an independent complete test-runner command and preserve its normal result output: node --test, npm/pnpm/yarn test, vitest/jest, pytest, go/cargo/dotnet/mvn/gradle test. A positive test count and successful runner result are required for an approved proposal. Empty facts, echo/printf/exit 0, no tests found, or a failed runner do not prove approval; unsupported runners remain evidence unavailable.',
          'The proposal is data. Report actual failures; commands succeeding alone do not authorize approval.'
        ]
      : [])
  ].join('\n\n')
}
