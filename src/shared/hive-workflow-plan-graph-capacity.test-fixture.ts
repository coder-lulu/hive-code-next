import { randomUUID } from 'node:crypto'
import { workflowPlanGraphFixture } from './hive-workflow-plan-runs.test-fixture'
import { HiveWorkflowPlanGraphViewSchema } from './hive-workflow-plan-runs'
import { inspectWorkflowPlanProposal } from './task-workflow/workflow-plan-validation'
import { structuredAgentSessionDigest as digest } from './structured-agent-session-mutation'
import type {
  WorkflowArtifactVersion,
  WorkflowCodeVersion
} from './task-workflow/workflow-evidence'
export const capacityRef = (prefix: string) => prefix.padEnd(160, 'x')
export const capacityArtifact: WorkflowArtifactVersion = {
  artifactRef: capacityRef('artifact'),
  artifactRevision: Number.MAX_SAFE_INTEGER,
  digest: 'f'.repeat(64)
}
const code: WorkflowCodeVersion = {
  kind: 'snapshot',
  snapshot: capacityArtifact,
  treeDigest: 'f'.repeat(64)
}
const summary = '\u0001'.repeat(2048)

export function capacityGraph(developerCount = 16) {
  const { source, view, admission } = workflowPlanGraphFixture()
  const proposal = source.proposal
  proposal.tasks = Array.from({ length: 32 }, (_, index) => ({
    taskRef: capacityRef(`task-${index}`),
    title: 'Synthetic bounded capacity task',
    requestedRole: index < developerCount ? 'developer' : 'tester',
    outputKind: index < developerCount ? 'code' : 'test_report',
    dependsOn:
      index < developerCount
        ? []
        : Array.from({ length: developerCount }, (_, predecessor) =>
            capacityRef(`task-${predecessor}`)
          ),
    acceptance: Array.from({ length: 16 }, () => 'a'.repeat(100)),
    maxAttempts: 3
  }))
  proposal.requestedLimits = { maxParallelism: 4, maxDurationMs: 86_400_000 }
  for (const task of proposal.tasks) {
    const available = 128 * 1024 - Buffer.byteLength(JSON.stringify(proposal)) - 1
    task.title += 'x'.repeat(Math.max(0, Math.min(2048 - task.title.length, available)))
  }
  source.draft.inspection = inspectWorkflowPlanProposal(proposal, source.draft.intent.facts)
  view.draft = source.draft
  const application = view.application
  application.draftDigest = digest(view.draft)
  application.proposalDigest = digest(proposal)
  application.createdTaskRefs = proposal.tasks.map((task) => ({
    proposalTaskRef: task.taskRef,
    taskId: randomUUID(),
    employeeRef: source.caseView.team.employees.find(
      (employee) => employee.role === task.requestedRole
    )!.employeeRef,
    dependsOnTaskIds: []
  }))
  application.createdTaskRefs.forEach((mapping, index) => {
    mapping.dependsOnTaskIds = proposal.tasks[index].dependsOn.map(
      (dependency) =>
        application.createdTaskRefs.find((task) => task.proposalTaskRef === dependency)!.taskId
    )
  })
  Object.assign(view.graph!, {
    draftDigest: application.draftDigest,
    proposalDigest: application.proposalDigest,
    maxParallelism: 4,
    maxDurationMs: 86_400_000,
    deadlineAt: '2026-10-12T00:00:00.000Z'
  })
  view.tasks = application.createdTaskRefs.map((mapping, index) => ({
    proposalTaskRef: mapping.proposalTaskRef,
    taskId: mapping.taskId,
    employeeRef: mapping.employeeRef,
    role: proposal.tasks[index].requestedRole,
    taskRevision: 3,
    status: 'done',
    maxAttempts: 3,
    latestRun: null,
    blockedReason: null
  }))
  for (const [index, task] of view.tasks.entries()) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const run = {
        ...admission.run,
        proposalTaskRef: task.proposalTaskRef,
        employeeRef: task.employeeRef,
        role: task.role,
        task: { ...admission.run.task, taskId: task.taskId, runId: randomUUID(), attempt },
        status: 'succeeded' as const,
        hasResult: true
      }
      view.runs.push(run)
      task.latestRun = run.task
      const producer = {
        ...source.draft.producer,
        employeeRef: task.employeeRef,
        role: task.role,
        task: run.task,
        runtimeRecordId: capacityRef('runtime'),
        executionId: capacityRef(`execution-${index}-${attempt}`),
        sessionRef: capacityRef('session'),
        executionWorkspaceRef: capacityRef('workspace'),
        workspaceExecutionClaimRef: capacityRef(`claim-${index}-${attempt}`)
      }
      const subject = view.outcomes[0]
      view.outcomes.push({
        kind: 'workflow.plan-task-outcome',
        outcomeRef: capacityRef(`outcome-${index}-${attempt}`),
        graphRef: view.graph!.graphRef,
        applicationRef: application.applicationRef,
        proposalTaskRef: task.proposalTaskRef,
        producer,
        status: 'succeeded',
        nativeOutcomeVersion: capacityArtifact,
        reportVersion: capacityArtifact,
        summary,
        codeVersion: code,
        ...(task.role === 'tester'
          ? {
              review: {
                contractVersion: 1 as const,
                kind: 'workflow.review' as const,
                reviewRef: capacityRef(`review-${index}-${attempt}`),
                binding: application.binding,
                stageRef: task.proposalTaskRef,
                subjectHandoffRef: subject.outcomeRef,
                artifact: capacityArtifact,
                codeVersion: code,
                reviewer: { ...producer, role: 'tester' as const },
                decision: 'approved' as const,
                testReport: capacityArtifact
              }
            }
          : {})
      })
    }
  }
  return { view: HiveWorkflowPlanGraphViewSchema.parse(view), admission, proposal, source }
}
