import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import {
  hiveWorkflowStageContext,
  hiveWorkflowStageDependencies
} from './hive-workflow-stage-context'
import {
  WORKFLOW_ROLE_INSTRUCTIONS,
  workflowRoleCompletion
} from './task-workflow/workflow-role-completion'
import { WorkflowPlanProposalSchema } from './task-workflow/workflow-plan-proposal'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'

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
  const planning = context.planIntent
  const planProposal = planning
    ? WorkflowPlanProposalSchema.parse({
        contractVersion: 1,
        kind: 'workflow.plan-proposal',
        binding: planning.facts.binding,
        definitionDigest: planning.facts.definitionDigest,
        goalRef: planning.facts.goalRef,
        planRevision: planning.facts.planRevision,
        tasks: [
          {
            taskRef: 'implementation',
            title: 'Implement the requested behavior.',
            requestedRole: 'developer',
            outputKind: 'code',
            dependsOn: [],
            acceptance: ['Implement the agreed requirements and preserve verification evidence.'],
            maxAttempts: 1
          },
          {
            taskRef: 'independent-test',
            title: 'Independently test the implementation.',
            requestedRole: 'tester',
            outputKind: 'test_report',
            dependsOn: ['implementation'],
            acceptance: ['Report actual independent checks, failures and results.'],
            maxAttempts: 1
          },
          {
            taskRef: 'release-preparation',
            title: 'Prepare the release plan.',
            requestedRole: 'ops',
            outputKind: 'release_plan',
            dependsOn: ['independent-test'],
            acceptance: ['Describe release prerequisites and rollback without deploying.'],
            maxAttempts: 1
          }
        ],
        requestedLimits: {
          maxParallelism: planning.facts.limits.maxParallelism,
          maxDurationMs: planning.facts.limits.maxDurationMs
        }
      })
    : undefined
  if (
    planProposal &&
    planning &&
    inspectWorkflowPlanProposal(planProposal, planning.facts).kind !== 'validated'
  ) {
    throw new Error('CAPABILITY_UNAVAILABLE')
  }
  return [
    `Workflow case: ${view.id}\nFixed stage: ${stage.stageRef}\nRole: ${stage.role}`,
    WORKFLOW_ROLE_INSTRUCTIONS[stage.role],
    ...(planProposal
      ? [
          'Also write plan-proposal.json alongside requirements.md and include both files in the original result manifest. Use this exact JSON shape and fixed goal, Case binding, definition digest and plan revision:',
          JSON.stringify(planProposal),
          `Frozen planning data policy: ${JSON.stringify(planning?.facts)}`,
          'Describe the requested implementation, independent testing and release preparation as proposal data. Replace the sample titles and acceptance checks with concrete checks for this original requirement. Keep references fixed and remain within the frozen limits. Do not add another Product loop. Omit optional resource, knowledge and budget declarations from the default proposal; explicit requests remain data and may be unavailable.',
          'The proposal never grants adoption or execution authority. Its inspection is readonly; the existing fixed four-role workflow remains the execution path.'
        ]
      : []),
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
    ...workflowRoleCompletion(context)
  ].join('\n\n')
}
