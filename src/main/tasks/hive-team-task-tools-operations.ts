import { randomUUID } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowCaseCreateSchema,
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCaseView
} from '../../shared/hive-workflow-cases'
import {
  HiveWorkflowCaseStartSchema,
  HiveWorkflowCaseRunSchema,
  HiveWorkflowCaseRunsSchema
} from '../../shared/hive-workflow-case-runs'
import type { HiveTeamTaskToolOptions } from './hive-team-task-tool-ports'
import type { TeamToolOperation, TeamToolReceipt } from './hive-team-task-tools-receipts'
import type { TeamToolScope } from './hive-team-task-tools-scope'
import { refuseTaskExecution } from './task-execution-error'

export type TeamToolOperationContext = {
  options: HiveTeamTaskToolOptions
  receipt: TeamToolReceipt
  scope: TeamToolScope
  assertCurrent(): void
  validateScope(): Promise<void>
  save(): Promise<void>
}

function assertCase(view: HiveWorkflowCaseView, operation: TeamToolOperation) {
  const scope = operation.scope
  if (
    (operation.caseRef !== null && view.id !== operation.caseRef) ||
    view.binding.scope.companyRef !== scope.companyId ||
    view.binding.scope.projectRef !== scope.projectId ||
    view.binding.workflowRef !== scope.workflowId ||
    view.binding.workflowRevision !== scope.workflowRevision ||
    view.projectBindingRevision !== scope.projectRevision ||
    view.definitionDigest !== scope.definitionDigest ||
    view.team.project.hiveWorkspaceRef !== scope.workspaceRef ||
    view.title !== operation.createInput.title ||
    view.requirement !== operation.createInput.requirement
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
}

export async function readTeamToolStatus(
  context: TeamToolOperationContext,
  operation: TeamToolOperation
) {
  await context.validateScope()
  if (!operation.caseRef) {
    return { state: 'creation_unconfirmed', retrySameStart: true }
  }
  const query = { projectId: operation.scope.projectId, caseId: operation.caseRef }
  const view = HiveWorkflowCaseViewSchema.parse(await context.options.facade.getWorkflowCase(query))
  context.assertCurrent()
  assertCase(view, operation)
  const runs = HiveWorkflowCaseRunsSchema.parse(
    await context.options.facade.getWorkflowCaseRuns(query)
  )
  context.assertCurrent()
  if (
    runs.some(
      (run) =>
        run.caseId !== view.id ||
        run.startRequest.projectId !== query.projectId ||
        run.task.spaceId !== operation.scope.companyId ||
        !view.stageTasks.some(
          (task) =>
            task.taskId === run.task.taskId &&
            task.stageRef === run.stageRef &&
            task.role === run.role &&
            task.employeeRef === run.employeeRef
        )
    )
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  await context.validateScope()
  const startInput = operation.startInput
  const startConfirmed =
    startInput !== null && runs.some((run) => digest(run.startRequest) === digest(startInput))
  const uncertainState = runs.some((run) => run.status === 'unknown')
    ? 'outcome_unknown'
    : runs.some((run) => run.status === 'cancelRequested')
      ? 'cancellation_pending'
      : null
  return {
    state:
      operation.startAttempted && !startConfirmed
        ? 'start_unconfirmed'
        : (uncertainState ?? view.terminalKind ?? (runs.length ? 'active' : 'created')),
    caseRef: view.id,
    title: view.title,
    currentStageRef: view.currentStageRef,
    stages: view.stageTasks.map((task) => ({ role: task.role, status: task.status })),
    runs: runs.map((run) => ({
      role: run.role,
      runId: run.task.runId,
      attempt: run.task.attempt,
      status: run.status
    })),
    planDraftCount: view.planDrafts.length,
    entry: 'Tasks > Team tasks > Case',
    executionAvailability: view.executionAvailability
  }
}

export async function startTeamToolCase(
  context: TeamToolOperationContext,
  input: { title: string; requirement: string },
  turnId: string,
  callId: string
) {
  const { receipt, scope } = context
  const payloadDigest = digest(input)
  let operation = receipt.operations.find((item) => item.turnId === turnId)
  const sameCall = receipt.operations.find((item) => item.callIds.includes(callId))
  if (
    (sameCall && sameCall !== operation) ||
    (operation &&
      (operation.payloadDigest !== payloadDigest || digest(operation.scope) !== digest(scope)))
  ) {
    return refuseTaskExecution('IDEMPOTENCY_CONFLICT')
  }
  if (!operation) {
    if (receipt.operations.length >= 32) {
      return refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    // Historical reads share one scope fence; each awaited read still checks live authority.
    const historyContext = { ...context, validateScope: async () => context.assertCurrent() }
    for (const previous of receipt.operations) {
      const status = await readTeamToolStatus(historyContext, previous)
      if (
        status.state === 'creation_unconfirmed' ||
        status.state === 'start_unconfirmed' ||
        status.runs?.some((run) => run.status === 'unknown' || run.status === 'cancelRequested')
      ) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
    }
    await context.validateScope()
    operation = {
      turnId,
      callIds: [callId],
      payloadDigest,
      scope,
      createInput: HiveWorkflowCaseCreateSchema.parse({
        requestId: randomUUID(),
        projectId: scope.projectId,
        workflowId: scope.workflowId,
        workflowRevision: scope.workflowRevision,
        definitionDigest: scope.definitionDigest,
        expectedProjectRevision: scope.projectRevision,
        ...input
      }),
      caseRef: null,
      startInput: null,
      startAttempted: false
    }
    receipt.operations.push(operation)
  } else if (!operation.callIds.includes(callId)) {
    if (operation.callIds.length >= 32) {
      return refuseTaskExecution('CAPACITY_EXCEEDED')
    }
    operation.callIds.push(callId)
  }
  await context.save()
  if (operation.startAttempted) {
    return readTeamToolStatus(context, operation)
  }
  await context.validateScope()
  const view = HiveWorkflowCaseViewSchema.parse(
    operation.caseRef
      ? await context.options.facade.getWorkflowCase({
          projectId: scope.projectId,
          caseId: operation.caseRef
        })
      : await context.options.facade.createWorkflowCase(operation.createInput)
  )
  context.assertCurrent()
  assertCase(view, operation)
  operation.caseRef = view.id
  await context.save()
  await context.validateScope()
  const stage = view.stageTasks.find((task) => task.stageRef === view.currentStageRef)
  if (!stage || view.terminalKind || stage.status !== 'backlog') {
    return readTeamToolStatus(context, operation)
  }
  operation.startInput ??= HiveWorkflowCaseStartSchema.parse({
    requestId: randomUUID(),
    projectId: scope.projectId,
    caseId: view.id,
    stageRef: view.currentStageRef,
    expectedCaseRevision: view.revision,
    expectedTaskRevision: stage.taskRevision
  })
  // Once sent, an uncertain start is observed through business reads, never dispatched again.
  operation.startAttempted = true
  await context.save()
  context.assertCurrent()
  const run = HiveWorkflowCaseRunSchema.parse(
    await context.options.facade.startWorkflowCase(operation.startInput)
  )
  context.assertCurrent()
  if (
    digest(run.startRequest) !== digest(operation.startInput) ||
    run.task.spaceId !== scope.companyId ||
    run.task.taskId !== stage.taskId ||
    run.employeeRef !== stage.employeeRef ||
    run.role !== stage.role
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  return readTeamToolStatus(context, operation)
}
