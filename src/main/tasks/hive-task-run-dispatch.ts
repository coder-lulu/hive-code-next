import type { TaskRef } from '../../shared/task-execution/task-execution-primitives'
import type { HiveTaskRequestContext, HiveTaskWorkspaceProof } from './hive-team-workbench-facade'
import type { LocalTaskBindingIssuer } from './local-task-binding-issuer'
import { hiveTaskRunPath, parseHiveTaskRun } from './hive-task-service-row'
import { refuseTaskExecution } from './task-execution-error'

/** Personal and workflow admissions share the original binding, then the original dispatcher. */
export async function bindAndDispatchHiveTask(options: {
  caller: HiveTaskRequestContext
  issuer: Pick<LocalTaskBindingIssuer, 'issue'>
  workspace: HiveTaskWorkspaceProof
  companyId: string
  employeeRef: string
  task: TaskRef
  workspaceSelector: string
  input: string
  executionMode?: 'enforced_autonomous'
  executionDeadlineAt?: string
  action?: 'cancel'
}) {
  const assertCurrent = () => {
    options.workspace.assertCurrent()
    options.caller.assertCurrent()
  }
  assertCurrent()
  const binding = await options.issuer.issue({
    paperclipCompanyId: options.companyId,
    paperclipAgentId: options.employeeRef,
    task: options.task,
    workspaceSelector: options.workspaceSelector,
    input: options.input,
    ...(options.executionMode ? { executionMode: options.executionMode } : {}),
    ...(options.executionDeadlineAt ? { executionDeadlineAt: options.executionDeadlineAt } : {})
  })
  assertCurrent()
  const path = hiveTaskRunPath(options.task.taskId, options.task.runId)
  const bound = parseHiveTaskRun(
    await options.caller.request(`${path}/binding`, binding),
    options.task.taskId,
    options.task.runId
  )
  assertCurrent()
  if (bound.company_id !== options.companyId || bound.agent_id !== options.employeeRef) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  if (options.action !== 'cancel') {
    await options.caller.request(`${path}/dispatch`, {})
  }
  assertCurrent()
  return bound
}
