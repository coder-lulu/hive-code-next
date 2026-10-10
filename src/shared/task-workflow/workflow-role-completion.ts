import type { WorkflowExecutionContext } from './workflow-execution-context'
import { WorkflowReviewProposalSchema } from './workflow-review-proposal'

export const WORKFLOW_ROLE_INSTRUCTIONS = {
  product:
    'Produce requirements.md with the requested behavior, constraints and explicit acceptance checks.',
  developer:
    'Implement the feature in this managed workspace. Produce implementation.md describing changes and verification.',
  tester:
    'Independently test the supplied immutable code version. Produce test-report.md with actual commands, results and a review decision.',
  ops: 'Produce release-plan.md with prerequisites, release checks and rollback steps. Deployment requires separate explicit owner approval.'
}

export function workflowRoleCompletion(context: WorkflowExecutionContext): string[] {
  return context.role === 'tester'
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
    : []
}
