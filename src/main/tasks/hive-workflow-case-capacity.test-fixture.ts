import { randomUUID } from 'node:crypto'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from '../../shared/hive-workflow-cases'
import { workflowPlanDraftFixture } from '../../shared/task-workflow/workflow-plan-draft.test-fixture'
import { inspectWorkflowPlanProposalJson } from '../../shared/task-workflow/workflow-plan-validation'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'

const ref = (value: string) => value.padEnd(160, 'x')
const version = {
  artifactRef: ref('artifact'),
  artifactRevision: Number.MAX_SAFE_INTEGER,
  digest: 'a'.repeat(64)
}

/** Synthetic schema-valid transport pressure; this does not represent executed runs or DB evidence. */
export function workflowCaseCapacityFixture() {
  const view = workflowCaseFixture().view
  view.title = '\u0001'.repeat(240)
  view.requirement = '\u0001'.repeat(48_000)
  const templates = view.workflow.definition.stages
  view.workflow.definition.stages = Array.from({ length: 32 }, (_, index) => ({
    ...templates[index % 4],
    stageRef: ref(`stage-${index}`),
    maxAttempts: 3,
    dependsOn: index ? [ref(`stage-${index - 1}`)] : [],
    returnToStageRef:
      templates[index % 4].role === 'tester' ? ref(`stage-${index - 1}`) : undefined,
    acceptanceCriteria: Array(16).fill('criterion')
  }))
  view.stageTasks = view.workflow.definition.stages.map((stage) => ({
    stageRef: stage.stageRef,
    role: stage.role,
    taskId: randomUUID(),
    employeeRef: view.team.employees.find((employee) => employee.role === stage.role)!.employeeRef,
    taskRevision: Number.MAX_SAFE_INTEGER,
    status: 'backlog'
  }))
  view.currentStageRef = view.stageTasks[0].stageRef
  view.workflow.definitionDigest = digest({
    name: view.workflow.name,
    definition: view.workflow.definition
  })
  view.definitionDigest = view.workflow.definitionDigest
  const producer = (index: number, attempt: number) => {
    const fixed = view.stageTasks[index]
    return {
      ...workflowPlanDraftFixture().producer,
      employeeRef: fixed.employeeRef,
      role: fixed.role,
      task: {
        spaceId: view.binding.scope.companyRef,
        taskId: fixed.taskId,
        runId: randomUUID(),
        attempt,
        taskRevision: ref('revision')
      },
      runtimeRecordId: ref('runtime'),
      executionId: ref('execution'),
      sessionRef: ref('session'),
      executionWorkspaceRef: ref('workspace'),
      workspaceExecutionClaimRef: ref('claim')
    }
  }
  view.handoffs = Array.from({ length: 96 }, (_, index) => {
    const source = Math.floor(index / 3),
      target = (source + 1) % 32
    const consumer = view.stageTasks[target]
    return {
      contractVersion: 1,
      kind: 'workflow.handoff',
      handoffRef: ref(`handoff-${index}`),
      binding: view.binding,
      stageRef: view.stageTasks[source].stageRef,
      producer: producer(source, (index % 3) + 1),
      consumer: {
        stageRef: consumer.stageRef,
        employeeRef: consumer.employeeRef,
        role: consumer.role
      },
      artifact: version,
      codeVersion: { kind: 'snapshot', snapshot: version, treeDigest: 'a'.repeat(64) },
      dependencyVersions: [],
      summary: '\u0001'.repeat(2048),
      audienceScope: {
        scope: view.binding.scope,
        employeeRefs: view.team.employees.map((employee) => employee.employeeRef)
      }
    }
  })
  for (const handoff of view.handoffs) {
    handoff.dependencyVersions = view.handoffs
      .filter((_, index) => index % 3 === 0)
      .map((item) => ({
        stageRef: item.stageRef,
        handoffRef: item.handoffRef,
        artifact: item.artifact
      }))
  }
  const developer = view.handoffs.find((item) => item.producer.role === 'developer')!
  const testerIndex = view.stageTasks.findIndex((item) => item.role === 'tester')
  view.reviews = Array.from({ length: 96 }, (_, index) => ({
    contractVersion: 1,
    kind: 'workflow.review',
    reviewRef: ref(`review-${index}`),
    binding: view.binding,
    stageRef: view.stageTasks[testerIndex].stageRef,
    subjectHandoffRef: developer.handoffRef,
    artifact: developer.artifact,
    codeVersion: developer.codeVersion!,
    reviewer: { ...producer(testerIndex, 1), role: 'tester' },
    decision: 'changes_requested',
    testReport: version
  }))
  view.executionNotices = Array.from({ length: 96 }, () => ({
    kind: 'workflow.case-execution-notice',
    eventRef: randomUUID(),
    stageRef: view.stageTasks[0].stageRef,
    causeRunId: randomUUID(),
    reason: 'context_unavailable',
    recordedAt: view.createdAt
  }))
  for (let index = 1; index <= 3; index++) {
    const draft = workflowPlanDraftFixture(),
      intent = draft.intent
    intent.intentRef = `intent-${index}`
    intent.stageRef = view.stageTasks[0].stageRef
    intent.employeeRef = view.stageTasks[0].employeeRef
    intent.sourceTask = producer(0, index).task
    intent.facts = {
      ...intent.facts,
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      goalRef: view.originTaskId,
      planRevision: index
    }
    draft.draftRef = `draft-${index}`
    draft.producer = { ...producer(0, index), role: 'product', task: intent.sourceTask }
    if (draft.inspection.kind !== 'validated') {
      throw new Error('Expected valid fixture')
    }
    const proposal = draft.inspection.proposal
    Object.assign(proposal, {
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      goalRef: view.originTaskId,
      planRevision: index
    })
    proposal.tasks = Array.from({ length: 32 }, (_, task) => ({
      taskRef: `task-${task}`,
      title: 'Implementation',
      requestedRole: 'developer',
      outputKind: 'code',
      dependsOn: [],
      acceptance: Array(16).fill('x'.repeat(200)),
      maxAttempts: 3
    }))
    let remaining = 131072 - Buffer.byteLength(JSON.stringify(proposal))
    for (const task of proposal.tasks) {
      for (let acceptance = 0; acceptance < task.acceptance.length && remaining > 0; acceptance++) {
        const extra = Math.min(2048 - task.acceptance[acceptance].length, remaining)
        task.acceptance[acceptance] += 'x'.repeat(extra)
        remaining -= extra
      }
    }
    if (remaining !== 0) {
      throw new Error('Plan capacity fixture could not reach exact byte boundary')
    }
    draft.inspection = inspectWorkflowPlanProposalJson(JSON.stringify(proposal), intent.facts)
    view.planDrafts.push(draft)
    view.planningIntent = intent
  }
  return HiveWorkflowCaseViewSchema.parse(view)
}
