import { randomUUID } from 'node:crypto'
import { workflowPlanApplicationFixture } from './hive-workflow-plan-application.test-fixture'
import {
  HiveWorkflowPlanGraphViewSchema,
  HiveWorkflowPlanRunAdmissionSchema
} from './hive-workflow-plan-runs'

export function workflowPlanGraphFixture() {
  const source = workflowPlanApplicationFixture()
  const graphRef = randomUUID()
  const view = HiveWorkflowPlanGraphViewSchema.parse({
    caseId: source.caseView.id,
    projectId: source.input.projectId,
    application: source.receipt,
    draft: source.draft,
    graph: {
      graphRef,
      applicationRef: source.receipt.applicationRef,
      requestId: randomUUID(),
      binding: source.receipt.binding,
      planRevision: source.receipt.planRevision,
      draftDigest: source.receipt.draftDigest,
      proposalDigest: source.receipt.proposalDigest,
      projectBindingRevision: source.receipt.projectBindingRevision,
      revision: 1,
      status: 'running',
      startedAt: '2026-10-11T00:00:00.000Z',
      deadlineAt: new Date(
        Date.parse('2026-10-11T00:00:00.000Z') + source.proposal.requestedLimits.maxDurationMs
      ).toISOString(),
      ...source.proposal.requestedLimits,
      retryBackoffMs: 1000
    },
    tasks: source.receipt.createdTaskRefs.map((mapping, index) => ({
      proposalTaskRef: mapping.proposalTaskRef,
      taskId: mapping.taskId,
      employeeRef: mapping.employeeRef,
      role: source.proposal.tasks[index].requestedRole,
      taskRevision: 0,
      status: 'todo',
      maxAttempts: source.proposal.tasks[index].maxAttempts,
      latestRun: null,
      blockedReason: null
    })),
    runs: [],
    outcomes: [],
    availability: { available: true }
  })
  const mapped = view.tasks[0]
  const task = {
    spaceId: source.receipt.binding.scope.companyRef,
    taskId: mapped.taskId,
    runId: randomUUID(),
    attempt: 1,
    taskRevision: '1'
  }
  const requestId = randomUUID()
  const admission = HiveWorkflowPlanRunAdmissionSchema.parse({
    requestId,
    payloadFingerprint: 'a'.repeat(64),
    replayed: false,
    run: {
      graphRef,
      applicationRef: source.receipt.applicationRef,
      proposalTaskRef: mapped.proposalTaskRef,
      role: mapped.role,
      employeeRef: mapped.employeeRef,
      task,
      status: 'pending',
      hasResult: false
    },
    startRequest: {
      requestId,
      graphRef,
      applicationRef: source.receipt.applicationRef,
      projectId: view.projectId,
      caseId: view.caseId,
      proposalTaskRef: mapped.proposalTaskRef,
      expectedTaskRevision: 0,
      attempt: 1
    },
    definitionDigest: source.draft.intent.facts.definitionDigest,
    projectBindingRevision: source.receipt.projectBindingRevision,
    input: 'Implement the original sealed requirement.',
    inputDigest: 'b'.repeat(64),
    workspaceSelector: 'workspace:graph',
    executionDeadlineAt: view.graph!.deadlineAt,
    workflowContext: {
      kind: 'workflow.execution-context',
      binding: source.receipt.binding,
      definitionDigest: source.draft.intent.facts.definitionDigest,
      stageRef: mapped.proposalTaskRef,
      employeeRef: mapped.employeeRef,
      role: mapped.role,
      handoffRefs: [],
      planExecution: {
        graphRef,
        applicationRef: source.receipt.applicationRef,
        planRevision: source.receipt.planRevision,
        draftDigest: source.receipt.draftDigest,
        proposalDigest: source.receipt.proposalDigest,
        proposalTaskRef: mapped.proposalTaskRef,
        sourceTask: task,
        dependencyOutcomes: []
      }
    }
  })
  return { source, view, admission }
}
