import type { WorkflowPlanProposal } from './workflow-plan-proposal'

export function workflowPlanProposalFixture(): WorkflowPlanProposal {
  return {
    contractVersion: 1,
    kind: 'workflow.plan-proposal',
    binding: {
      scope: { companyRef: 'company-test', projectRef: 'project-test' },
      workflowRef: 'workflow-test',
      workflowRevision: 1,
      workflowRunRef: 'workflow-run-test'
    },
    definitionDigest: 'a'.repeat(64),
    goalRef: 'goal-test',
    planRevision: 1,
    tasks: [
      {
        taskRef: 'research-test',
        title: 'Research the synthetic requirement.',
        requestedRole: 'product',
        outputKind: 'requirements',
        dependsOn: [],
        acceptance: ['Describe the synthetic requirement and its evidence.'],
        maxAttempts: 1
      }
    ],
    requestedLimits: { maxParallelism: 1, maxDurationMs: 60_000 }
  }
}
