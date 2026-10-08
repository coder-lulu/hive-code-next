import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import type { WorkflowHandoff } from '../../shared/task-workflow/workflow-evidence'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import type { HiveTaskServiceRowSchema } from './hive-task-service-row'
import type { z } from 'zod'
import type { TaskExecutionRecord } from './task-execution-record'
import { taskCodeSnapshotProducer } from './task-code-snapshot-producer'
import { refuseTaskExecution } from './task-execution-error'
import { isTaskDockerEnforcementPolicy } from './task-docker-enforcement'

export function assertWorkflowCaseCodeProducer(
  view: HiveWorkflowCaseView,
  handoff: WorkflowHandoff,
  task: z.infer<typeof HiveTaskServiceRowSchema>,
  record: TaskExecutionRecord,
  accountRef: string
) {
  const native = taskCodeSnapshotProducer(record)
  const binding = HiveRuntimeAdapterBinding.safeParse(task.binding)
  const context = record.command.workflowContext
  const stage = view.stageTasks.find((item) => item.stageRef === handoff.stageRef)
  const roleExecution = {
    employeeRef: context?.employeeRef,
    role: context?.role,
    task: native.task,
    runtimeRecordId: native.runtimeRecordId,
    ownershipEpoch: native.ownershipEpoch,
    executionId: native.executionId,
    executionEpoch: native.executionEpoch,
    commandFingerprint: native.commandFingerprint,
    sessionRef: native.sessionRef,
    executionWorkspaceRef: native.executionWorkspaceId,
    workspaceExecutionClaimRef: native.workspaceExecutionClaimRef
  }
  if (
    !binding.success ||
    !context ||
    !stage ||
    handoff.producer.role !== 'developer' ||
    context.role !== 'developer' ||
    native.status !== 'succeeded' ||
    record.operationCallerKey !== 'trusted-local:runtime' ||
    !isTaskDockerEnforcementPolicy(record.command.executionPolicy) ||
    !record.dockerIdentity?.containerId ||
    digest(roleExecution) !== digest(handoff.producer) ||
    digest(handoff.binding) !== digest(view.binding) ||
    digest(context.binding) !== digest(view.binding) ||
    context.definitionDigest !== view.definitionDigest ||
    context.stageRef !== handoff.stageRef ||
    context.employeeRef !== stage.employeeRef ||
    native.task.taskId !== stage.taskId ||
    native.task.spaceId !== view.binding.scope.companyRef ||
    native.executionAccountRef !== accountRef ||
    native.executionAccountRef !== view.team.company.ownerAccountRef ||
    digest(native.ownerScope) !== digest(view.team.company.ownerScope) ||
    native.workspaceRef !== view.team.project.hiveWorkspaceRef ||
    binding.data.paperclipCompanyId !== view.binding.scope.companyRef ||
    binding.data.paperclipAgentId !== stage.employeeRef ||
    binding.data.commandFingerprint !== native.commandFingerprint ||
    computeTaskExecutionFingerprint(binding.data.command, record.operationCallerKey) !==
      native.commandFingerprint ||
    task.company_id !== view.binding.scope.companyRef ||
    task.agent_id !== stage.employeeRef ||
    task.run_scope?.kind !== 'workbenchCase' ||
    task.run_scope.caseId !== view.id ||
    task.run_scope.projectId !== view.binding.scope.projectRef ||
    task.run_scope.workspaceRef !== native.workspaceRef ||
    task.execution_stage !== 'settled' ||
    task.cancel_requested ||
    digest({ value: task.result_receipt }) !== digest({ value: record.result })
  ) {
    refuseTaskExecution('REVISION_CONFLICT')
  }
}
