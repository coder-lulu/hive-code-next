import type { HiveWorkflowCaseView } from './hive-workflow-cases'
import {
  hiveWorkflowStageContext,
  hiveWorkflowStageDependencies
} from './hive-workflow-stage-context'
import { WorkflowReviewProposalSchema } from './task-workflow/workflow-review-proposal'
import { WorkflowPlanProposalSchema } from './task-workflow/workflow-plan-proposal'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'

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
    ROLE_INSTRUCTIONS[stage.role],
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
          'Invoke the test runner as its own exec_command tool call with cwd /workspace, for example command "node --test clamp.independent.test.mjs". Preserve that call\'s original exit code and output. Create test files and save reports in separate calls. Do not combine the runner with cd, other commands, shell redirects, pipes, &&, ||, semicolons, set +e, exit 0, or command substitution. Reading a saved log later does not replace the runner\'s own evidence.',
          'The proposal is data. Report actual failures; commands succeeding alone do not authorize approval.'
        ]
      : [])
  ].join('\n\n')
}
