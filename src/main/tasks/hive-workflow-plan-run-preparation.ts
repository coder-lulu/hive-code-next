import type { HiveTeamWorkbenchApi } from '../../shared/hive-team-workbench'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowPlanRunReadSchema,
  HiveWorkflowPlanRunAdmissionSchema,
  HiveWorkflowPlanGraphViewSchema
} from '../../shared/hive-workflow-plan-runs'
import type { HiveWorkflowCasesApi } from '../../shared/hive-workflow-cases'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from '../../shared/hive-workflow-plan-graph-context'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext,
  type HiveTaskWorkspaceProof
} from './hive-team-workbench-facade'
import { assertWorkflowPlanGraphSource } from './hive-workflow-plan-graph-source'
import { bindHiveTask } from './hive-task-run-dispatch'
import { hiveTaskRunPath, parseHiveTaskRun } from './hive-task-service-row'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'
import { assertTaskAuthorizationCurrent } from './task-structured-launch-origin'
import { refuseTaskExecution } from './task-execution-error'

export type WorkflowPlanRunPreparerOptions = {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
  getTeam: HiveTeamWorkbenchApi['getTeam']
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  enforcement?: () => Promise<{ assertCurrent(): void }>
}

export function createWorkflowPlanRunPreparer(options: WorkflowPlanRunPreparerOptions) {
  return async (value: unknown, assertHostCurrent: () => void) => {
    const parsed = HiveWorkflowPlanRunReadSchema.safeParse(value)
    if (!parsed.success) {
      return refuseTaskExecution('INVALID_REQUEST')
    }
    const refs = parsed.data
    const query = {
      projectId: refs.projectId,
      caseId: refs.caseId,
      applicationRef: refs.applicationRef
    }
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
    const team = await options.getTeam(refs.projectId)
    assertHiveWorkbenchCompanyOwner(team.company.binding, caller.accountRef)
    const selector = team.project.workspaceSelector
    guard()
    const workspace = await options.validateWorkspace(selector)
    guard()
    const admission = HiveWorkflowPlanRunAdmissionSchema.safeParse(
      await caller.request('/hive/workbench/plans/run-read', refs)
    )
    guard()
    if (!admission.success) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const frozen = admission.data
    const cancelling = frozen.run.status === 'cancelRequested'
    const assertCurrent = () => {
      guard()
      assertTaskAuthorizationCurrent(() => workspace.assertCurrent())
      assertTaskAuthorizationCurrent(() => enforcement.assertCurrent())
      if (!cancelling && Date.parse(frozen.executionDeadlineAt) <= Date.now()) {
        return refuseTaskExecution('FORBIDDEN')
      }
    }
    const readView = async () => {
      const original = await options.getWorkflowCase({
        projectId: refs.projectId,
        caseId: refs.caseId
      })
      assertCurrent()
      assertHiveWorkbenchCompanyOwner(original.team.company, caller.accountRef)
      const view = HiveWorkflowPlanGraphViewSchema.parse(
        await caller.request('/hive/workbench/plans/graph-read', query)
      )
      assertCurrent()
      assertWorkflowPlanGraphSource(view, query, original)
      return { original, view }
    }
    const assertAdmissionCurrent = async (issued?: HiveRuntimeBinding) => {
      assertCurrent()
      let { original, view } = await readView()
      const currentTeam = await options.getTeam(refs.projectId)
      assertCurrent()
      assertHiveWorkbenchCompanyOwner(currentTeam.company.binding, caller.accountRef)
      if (
        currentTeam.project.id !== refs.projectId ||
        currentTeam.project.binding.bindingRevision !== frozen.projectBindingRevision ||
        currentTeam.project.binding.hiveWorkspaceRef !== workspace.workspaceRef ||
        currentTeam.project.workspaceSelector !== selector
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      assertCurrent()
      const raw = await caller.request(hiveTaskRunPath(refs.taskId, refs.runId))
      assertCurrent()
      const task = parseHiveTaskRun(raw, refs.taskId, refs.runId)
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
        .safeParse(raw)
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
        if (view.tasks.find((item) => item.taskId === refs.taskId)?.status === 'todo') {
          ;({ original, view } = await readView())
        }
      }
      const graph = view.graph
      const projected = view.tasks.find((item) => item.taskId === refs.taskId)
      const run = view.runs.find((item) => item.task.runId === refs.runId)
      const revision = Number(frozen.run.task.taskRevision) + Number(bound)
      if (
        !pending.success ||
        task.result_receipt ||
        task.cancel_requested !== cancelling ||
        task.company_id !== frozen.run.task.spaceId ||
        task.agent_id !== frozen.run.employeeRef ||
        task.status !== (bound ? 'in_progress' : 'todo') ||
        task.status_version !== revision ||
        task.run_scope?.kind !== 'workbenchPlan' ||
        task.run_scope.projectId !== refs.projectId ||
        task.run_scope.caseId !== refs.caseId ||
        task.run_scope.applicationRef !== refs.applicationRef ||
        task.run_scope.graphRef !== frozen.run.graphRef ||
        task.run_scope.proposalTaskRef !== frozen.run.proposalTaskRef ||
        task.run_scope.workspaceRef !== workspace.workspaceRef ||
        !graph ||
        graph.graphRef !== frozen.run.graphRef ||
        (cancelling
          ? !['running', 'paused', 'cancel_requested'].includes(graph.status)
          : graph.status !== 'running') ||
        (!cancelling && original.terminalKind === 'cancelled') ||
        !projected ||
        projected.taskRevision !== revision ||
        projected.status !== task.status ||
        !projected.latestRun ||
        digest(projected.latestRun) !== digest(frozen.run.task) ||
        !run ||
        run.status !== (cancelling ? 'cancelRequested' : 'pending') ||
        run.hasResult ||
        digest(run.task) !== digest(frozen.run.task) ||
        frozen.run.status !== (cancelling ? 'cancelRequested' : 'pending') ||
        frozen.run.task.taskId !== refs.taskId ||
        frozen.run.task.runId !== refs.runId ||
        frozen.startRequest.projectId !== refs.projectId ||
        frozen.startRequest.caseId !== refs.caseId ||
        frozen.startRequest.applicationRef !== refs.applicationRef ||
        frozen.payloadFingerprint !==
          digest({ operation: 'plans.run.start', input: frozen.startRequest }) ||
        frozen.definitionDigest !== original.definitionDigest ||
        frozen.projectBindingRevision !== original.projectBindingRevision ||
        frozen.executionDeadlineAt !== graph.deadlineAt ||
        frozen.workspaceSelector !== selector ||
        workspace.workspaceRef !== original.team.project.hiveWorkspaceRef ||
        frozen.inputDigest !==
          createHash('sha256').update(JSON.stringify(frozen.input)).digest('hex')
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      const context = hiveWorkflowPlanGraphContext(
        original,
        view,
        frozen.run.proposalTaskRef,
        frozen.run.task
      )
      if (
        digest(frozen.workflowContext) !== digest(context) ||
        frozen.input !==
          hiveWorkflowPlanGraphPrompt(original, view, frozen.run.proposalTaskRef, context)
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return bound && issued ? task : undefined
    }
    await assertAdmissionCurrent()
    let issuedBinding: HiveRuntimeBinding | undefined
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
      ...(cancelling ? { action: 'cancel' as const } : {}),
      assertCommitCurrent: async (binding) => {
        issuedBinding = binding
        return assertAdmissionCurrent(binding)
      }
    })
    assertCurrent()
    if (!bound.binding || bound.cancel_requested !== cancelling || bound.result_receipt) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    if (!issuedBinding || !(await assertAdmissionCurrent(issuedBinding))) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    assertCurrent()
    return refs
  }
}
