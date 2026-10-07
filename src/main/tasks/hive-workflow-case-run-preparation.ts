import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowCaseRunAdmissionSchema,
  HiveWorkflowCaseRunReadSchema,
  type HiveWorkflowCaseRun
} from '../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseView, HiveWorkflowCasesApi } from '../../shared/hive-workflow-cases'
import { hiveWorkflowStageContext } from '../../shared/hive-workflow-stage-context'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext,
  type HiveTaskWorkspaceProof
} from './hive-team-workbench-facade'
import { bindHiveTask } from './hive-task-run-dispatch'
import { hiveTaskRunPath, parseHiveTaskRun } from './hive-task-service-row'
import { refuseTaskExecution } from './task-execution-error'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'

export function assertWorkflowCaseRunScope(run: HiveWorkflowCaseRun, view: HiveWorkflowCaseView) {
  const task = view.stageTasks.find((candidate) => candidate.stageRef === run.stageRef)
  const stage = view.workflow.definition.stages.find(
    (candidate) => candidate.stageRef === run.stageRef
  )
  if (
    run.caseId !== view.id ||
    run.task.spaceId !== view.binding.scope.companyRef ||
    run.startRequest.projectId !== view.binding.scope.projectRef ||
    !task ||
    !stage ||
    task.taskId !== run.task.taskId ||
    task.employeeRef !== run.employeeRef ||
    task.role !== run.role ||
    run.task.attempt > stage.maxAttempts
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
}

export function createWorkflowCaseRunPreparer(options: {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
  workspaceSelector(projectId: string): Promise<string>
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  enforcement?: () => Promise<{ assertCurrent(): void }>
}) {
  return async (value: unknown, assertHostCurrent: () => void) => {
    const parsed = HiveWorkflowCaseRunReadSchema.safeParse(value)
    if (!parsed.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const refs = parsed.data
    assertTaskAuthorizationCurrent(assertHostCurrent)
    const caller = await options.context()
    const guard = () => {
      assertTaskAuthorizationCurrent(assertHostCurrent)
      assertTaskAuthorizationCurrent(() => caller.assertCurrent())
    }
    guard()
    if (!options.enforcement) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const enforcement = await options.enforcement()
    guard()
    const view = await options.getWorkflowCase({ projectId: refs.projectId, caseId: refs.caseId })
    guard()
    assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
    const selector = await options.workspaceSelector(refs.projectId)
    guard()
    const workspace = await options.validateWorkspace(selector)
    guard()
    const admission = HiveWorkflowCaseRunAdmissionSchema.safeParse(
      await caller.request('/hive/workbench/cases/run-read', refs)
    )
    guard()
    if (!admission.success) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const frozen = admission.data
    const assertCurrent = () => {
      guard()
      assertTaskAuthorizationCurrent(() => workspace.assertCurrent())
      assertTaskAuthorizationCurrent(() => enforcement.assertCurrent())
      if (Date.parse(frozen.executionDeadlineAt) <= Date.now()) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    const assertView = (current: HiveWorkflowCaseView, bound: boolean) => {
      assertHiveWorkbenchCompanyOwner(current.team.company, caller.accountRef)
      assertWorkflowCaseRunScope(frozen.run, current)
      const stage = current.stageTasks.find((item) => item.stageRef === frozen.run.stageRef)!
      if (
        current.id !== refs.caseId ||
        current.binding.scope.projectRef !== refs.projectId ||
        current.terminalKind !== null ||
        current.currentStageRef !== frozen.run.stageRef ||
        current.revision !== frozen.run.startRequest.expectedCaseRevision ||
        stage.taskRevision !== Number(frozen.run.task.taskRevision) + Number(bound) ||
        stage.status !== (bound ? 'in_progress' : 'todo') ||
        frozen.run.status !== 'pending' ||
        frozen.run.task.taskId !== refs.taskId ||
        frozen.run.task.runId !== refs.runId ||
        frozen.requestId !== frozen.run.startRequest.requestId ||
        frozen.payloadFingerprint !==
          digest({ operation: 'cases.start', input: frozen.run.startRequest }) ||
        frozen.definitionDigest !== current.definitionDigest ||
        frozen.projectBindingRevision !== current.projectBindingRevision ||
        frozen.workspaceSelector !== selector ||
        workspace.workspaceRef !== current.team.project.hiveWorkspaceRef ||
        !frozen.workflowContext ||
        digest(frozen.workflowContext) !==
          digest(hiveWorkflowStageContext(current, frozen.run.stageRef)) ||
        frozen.inputDigest !==
          createHash('sha256').update(JSON.stringify(frozen.input)).digest('hex')
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
    }
    const assertAdmissionCurrent = async (issued?: HiveRuntimeBinding) => {
      assertCurrent()
      let currentView = await options.getWorkflowCase({
        projectId: refs.projectId,
        caseId: refs.caseId
      })
      assertCurrent()
      if ((await options.workspaceSelector(refs.projectId)) !== selector) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      assertCurrent()
      const rawTask = await caller.request(hiveTaskRunPath(refs.taskId, refs.runId))
      const task = parseHiveTaskRun(rawTask, refs.taskId, refs.runId)
      const bound = task.binding != null
      const pending = z
        .object({
          run_status: z.literal('queued'),
          driver_kind: z.literal('hive_runtime'),
          checkout_run_id: bound ? z.literal(refs.runId) : z.null(),
          execution_locked_at: bound ? z.iso.datetime({ offset: true }) : z.null(),
          execution_run_id: z.literal(refs.runId),
          execution_stage: z.null()
        })
        .safeParse(rawTask)
      assertCurrent()
      if (
        !pending.success ||
        task.result_receipt ||
        task.cancel_requested ||
        task.execution_stage === 'outcome_unknown' ||
        task.company_id !== frozen.run.task.spaceId ||
        task.agent_id !== frozen.run.employeeRef ||
        task.status !== (bound ? 'in_progress' : 'todo') ||
        task.status_version !== Number(frozen.run.task.taskRevision) + Number(bound) ||
        task.run_scope?.kind !== 'workbenchCase' ||
        task.run_scope.projectId !== refs.projectId ||
        task.run_scope.caseId !== refs.caseId ||
        task.run_scope.workspaceRef !== workspace.workspaceRef
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      if (bound) {
        const binding = HiveRuntimeAdapterBinding.safeParse(task.binding)
        const immutable = (value: HiveRuntimeBinding) => ({
          ...value,
          command: { ...value.command, expiresAt: null }
        })
        if (
          !binding.success ||
          (issued && digest(immutable(binding.data)) !== digest(immutable(issued)))
        ) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        // The two reads may straddle the one durable binding transition.
        if (
          currentView.stageTasks.find((item) => item.stageRef === frozen.run.stageRef)?.status ===
          'todo'
        ) {
          currentView = await options.getWorkflowCase({
            projectId: refs.projectId,
            caseId: refs.caseId
          })
          assertCurrent()
        }
      }
      assertView(currentView, bound)
      return bound && issued ? task : undefined
    }
    assertCurrent()
    assertView(
      view,
      view.stageTasks.find((item) => item.stageRef === frozen.run.stageRef)?.status ===
        'in_progress'
    )
    await assertAdmissionCurrent()
    const bound = await bindHiveTask({
      caller,
      issuer: options.issuer,
      workspace: { workspaceRef: workspace.workspaceRef, assertCurrent },
      companyId: frozen.run.task.spaceId,
      employeeRef: frozen.run.employeeRef,
      task: frozen.run.task,
      workspaceSelector: selector,
      input: frozen.input,
      executionMode: 'enforced_autonomous',
      executionDeadlineAt: frozen.executionDeadlineAt,
      workflowContext: frozen.workflowContext,
      assertCommitCurrent: assertAdmissionCurrent
    })
    assertCurrent()
    if (!bound.binding || bound.cancel_requested || bound.result_receipt) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    return refs
  }
}
