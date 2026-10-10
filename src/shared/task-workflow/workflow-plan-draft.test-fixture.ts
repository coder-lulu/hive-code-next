import type { WorkflowPlanDraft } from './workflow-plan-draft'
import type { WorkflowPlanIntent } from './workflow-plan-intent'
import { workflowPlanProposalFixture } from './workflow-plan-proposal.test-fixture'
import { inspectWorkflowPlanProposal } from './workflow-plan-validation'

export function workflowPlanIntentFixture(): WorkflowPlanIntent {
  const proposal = workflowPlanProposalFixture()
  return {
    contractVersion: 1,
    kind: 'workflow.plan-intent',
    intentRef: 'intent-test',
    sourceTask: {
      spaceId: proposal.binding.scope.companyRef,
      taskId: 'product-task-test',
      runId: 'product-run-test',
      attempt: 1,
      taskRevision: '1'
    },
    stageRef: 'product-stage-test',
    employeeRef: 'product-employee-test',
    policyRef: 'workflow.plan-inspection',
    policyRevision: 1,
    facts: {
      binding: proposal.binding,
      definitionDigest: proposal.definitionDigest,
      goalRef: proposal.goalRef,
      planRevision: proposal.planRevision,
      authorizedRoles: ['product', 'developer', 'tester', 'ops'],
      limits: { maxTasks: 32, maxParallelism: 4, maxDurationMs: 86_400_000, maxAttempts: 3 }
    }
  }
}

export function workflowPlanDraftFixture(): WorkflowPlanDraft {
  const intent = workflowPlanIntentFixture()
  const inspection = inspectWorkflowPlanProposal(workflowPlanProposalFixture(), intent.facts)
  if (inspection.kind !== 'validated') {
    throw new Error('Synthetic plan fixture must be valid.')
  }
  return {
    contractVersion: 1,
    kind: 'workflow.plan-draft',
    draftRef: 'draft-test',
    intent,
    producer: {
      employeeRef: intent.employeeRef,
      role: 'product',
      task: { ...intent.sourceTask },
      runtimeRecordId: 'runtime-test',
      ownershipEpoch: 1,
      executionId: 'execution-test',
      executionEpoch: 1,
      commandFingerprint: 'b'.repeat(64),
      sessionRef: 'session-test',
      executionWorkspaceRef: 'workspace-test',
      workspaceExecutionClaimRef: 'workspace-claim-test'
    },
    outcomeVersion: {
      artifactRef: `artifact:${'c'.repeat(64)}`,
      artifactRevision: 1,
      digest: 'c'.repeat(64)
    },
    sourceInputDigest: 'd'.repeat(64),
    artifact: {
      artifactRef: `artifact:${'e'.repeat(64)}`,
      artifactRevision: 1,
      digest: 'f'.repeat(64)
    },
    inspection
  }
}
