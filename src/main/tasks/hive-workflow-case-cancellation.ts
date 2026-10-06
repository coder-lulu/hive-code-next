import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { HiveWorkflowCaseRunAdmissionSchema } from '../../shared/hive-workflow-case-runs'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import type { HiveTaskRequestContext, HiveTaskWorkspaceProof } from './hive-team-workbench-facade'
import { bindAndDispatchHiveTask } from './hive-task-run-dispatch'
import { refuseTaskExecution } from './task-execution-error'

/** Completes a queued, cancelled admission's binding so the original host can prove it never started. */
export async function prepareWorkflowCaseCancellation(options: {
  caller: HiveTaskRequestContext
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
  taskId: string
  runId: string
  projectId: string
  caseId: string
  companyId: string
  employeeRef: string
  workspaceRef: string
}) {
  const admission = HiveWorkflowCaseRunAdmissionSchema.parse(
    await options.caller.request('/hive/workbench/cases/run-read', {
      projectId: options.projectId,
      caseId: options.caseId,
      taskId: options.taskId,
      runId: options.runId
    })
  )
  options.caller.assertCurrent()
  if (
    admission.run.caseId !== options.caseId ||
    admission.run.task.spaceId !== options.companyId ||
    admission.run.startRequest.projectId !== options.projectId ||
    admission.requestId !== admission.run.startRequest.requestId ||
    admission.payloadFingerprint !==
      canonicalAgentSessionDigest({
        operation: 'cases.start',
        input: admission.run.startRequest
      }) ||
    admission.run.task.taskId !== options.taskId ||
    admission.run.task.runId !== options.runId ||
    admission.run.employeeRef !== options.employeeRef ||
    admission.run.status !== 'cancelRequested' ||
    admission.inputDigest !==
      createHash('sha256').update(JSON.stringify(admission.input)).digest('hex')
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const workspace = await options.validateWorkspace(admission.workspaceSelector)
  workspace.assertCurrent()
  options.caller.assertCurrent()
  if (workspace.workspaceRef !== options.workspaceRef) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  await bindAndDispatchHiveTask({
    caller: options.caller,
    issuer: options.issuer,
    workspace,
    companyId: options.companyId,
    employeeRef: options.employeeRef,
    task: admission.run.task,
    workspaceSelector: admission.workspaceSelector,
    input: admission.input,
    executionMode: 'enforced_autonomous',
    executionDeadlineAt: admission.executionDeadlineAt,
    action: 'cancel'
  })
}
