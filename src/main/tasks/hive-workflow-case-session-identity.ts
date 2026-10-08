import { createHash } from 'node:crypto'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { isAgentSessionRecord, type AgentSessionRecord } from '../../shared/agent-session-record'
import type { HiveWorkflowCaseRunAdmissionSchema } from '../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import type { z } from 'zod'
import { assertWorkflowCaseRunScope } from './hive-workflow-case-run-preparation'
import { assertHiveWorkbenchCompanyOwner } from './hive-team-workbench-facade'
import type { HiveTaskServiceRowSchema } from './hive-task-service-row'
import type { LocalTaskRuntimeOwner } from './local-task-binding-options'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { TaskExecutionRecordSchema, type TaskExecutionRecord } from './task-execution-record'
import { refuseTaskExecution } from './task-execution-error'

type Admission = z.infer<typeof HiveWorkflowCaseRunAdmissionSchema>
export function assertWorkflowSessionOwner(
  owner: LocalTaskRuntimeOwner | null,
  accountRef: string
) {
  if (
    !owner ||
    accountRef !==
      `account:${createHash('sha256').update(JSON.stringify(owner.accountId)).digest('hex')}`
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  return owner
}

/** Mutable execution/lease progress never grants a different original read identity. */
export function workflowSessionNativeIdentity(
  recordValue: TaskExecutionRecord,
  session: AgentSessionRecord | null,
  owner: LocalTaskRuntimeOwner,
  accountRef: string
) {
  const parsed = TaskExecutionRecordSchema.safeParse(recordValue)
  if (!parsed.success) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const record = parsed.data,
    binding = record.structuredBinding,
    command = record.command
  assertWorkflowSessionOwner(owner, accountRef)
  if (
    command.runtimeRecordId !== owner.runtimeRecordId ||
    command.ownershipEpoch !== owner.ownershipEpoch ||
    command.executionAccountRef !== accountRef ||
    command.ownerScope.kind !== 'personalTenant' ||
    command.ownerScope.tenantRef !== accountRef ||
    record.operationCallerKey !== 'trusted-local:runtime'
  ) {
    return refuseTaskExecution('FORBIDDEN')
  }
  if (!binding || !session) {
    return refuseTaskExecution('EXECUTION_NOT_FOUND')
  }
  if (
    !isAgentSessionRecord(session) ||
    session.sessionId !== binding.sessionId ||
    session.provider !== 'codex' ||
    session.lease.runtimeKind !== 'native' ||
    digest({ value: session.taskSource ?? null }) !== digest({ value: binding.source }) ||
    digest(session.location) !== digest(binding.location) ||
    digest(session.accountHome) !== digest(binding.accountHome)
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  return digest({
    commandFingerprint: record.commandFingerprint,
    operationCallerKey: record.operationCallerKey,
    workspace: record.workspace,
    structuredBinding: binding,
    session: {
      sessionId: session.sessionId,
      provider: session.provider,
      location: session.location,
      accountHome: session.accountHome,
      taskSource: session.taskSource
    }
  })
}

export function workflowCaseSessionIdentity(input: {
  view: HiveWorkflowCaseView
  admission: Admission
  task: z.infer<typeof HiveTaskServiceRowSchema>
  record: TaskExecutionRecord
  session: AgentSessionRecord | null
  owner: LocalTaskRuntimeOwner
  accountRef: string
  refs: { projectId: string; caseId: string; taskId: string; runId: string }
}) {
  const { view, admission, task, record, owner, session, accountRef, refs } = input
  assertHiveWorkbenchCompanyOwner(view.team.company, accountRef)
  assertWorkflowCaseRunScope(admission.run, view)
  const binding = HiveRuntimeAdapterBinding.safeParse(task.binding)
  const run = admission.run,
    context = record.command.workflowContext
  const employee = view.team.employees.find((item) => item.employeeRef === run.employeeRef)
  const inputDigest = createHash('sha256').update(JSON.stringify(admission.input)).digest('hex')
  if (
    !binding.success ||
    !context ||
    !admission.workflowContext ||
    !employee ||
    view.id !== refs.caseId ||
    view.binding.scope.projectRef !== refs.projectId ||
    run.task.taskId !== refs.taskId ||
    run.task.runId !== refs.runId ||
    admission.requestId !== run.startRequest.requestId ||
    admission.payloadFingerprint !==
      digest({ operation: 'cases.start', input: run.startRequest }) ||
    admission.definitionDigest !== view.definitionDigest ||
    admission.projectBindingRevision !== view.projectBindingRevision ||
    admission.inputDigest !== inputDigest ||
    record.command.inputRef !== `input:${inputDigest}` ||
    record.command.executionDeadlineAt !== admission.executionDeadlineAt ||
    digest(record.command.task) !== digest(run.task) ||
    digest(context) !== digest(admission.workflowContext) ||
    digest(context.binding) !== digest(view.binding) ||
    context.definitionDigest !== view.definitionDigest ||
    context.stageRef !== run.stageRef ||
    context.employeeRef !== run.employeeRef ||
    context.role !== run.role ||
    digest(record.command.ownerScope) !== digest(view.team.company.ownerScope) ||
    record.command.workspaceRef !== view.team.project.hiveWorkspaceRef ||
    record.command.profileId !== employee.profileRef ||
    record.command.profileRevision !== employee.profileRevision ||
    binding.data.paperclipCompanyId !== run.task.spaceId ||
    binding.data.paperclipAgentId !== run.employeeRef ||
    binding.data.commandFingerprint !== record.commandFingerprint ||
    computeTaskExecutionFingerprint(binding.data.command, record.operationCallerKey) !==
      record.commandFingerprint ||
    task.company_id !== run.task.spaceId ||
    task.agent_id !== run.employeeRef ||
    task.run_scope?.kind !== 'workbenchCase' ||
    task.run_scope.projectId !== refs.projectId ||
    task.run_scope.caseId !== refs.caseId ||
    task.run_scope.workspaceRef !== record.command.workspaceRef ||
    task.workspace_selector !== admission.workspaceSelector
  ) {
    return refuseTaskExecution('REVISION_CONFLICT')
  }
  const native = workflowSessionNativeIdentity(record, session, owner, accountRef)
  return {
    native,
    service: digest({
      caseId: view.id,
      title: view.title,
      requirement: view.requirement,
      originTaskId: view.originTaskId,
      workflow: view.workflow,
      stageTasks: view.stageTasks.map(({ stageRef, taskId, employeeRef, role }) => ({
        stageRef,
        taskId,
        employeeRef,
        role
      })),
      binding: view.binding,
      definitionDigest: view.definitionDigest,
      projectBindingRevision: view.projectBindingRevision,
      team: view.team,
      admission: {
        requestId: admission.requestId,
        payloadFingerprint: admission.payloadFingerprint,
        run: {
          caseId: run.caseId,
          stageRef: run.stageRef,
          role: run.role,
          employeeRef: run.employeeRef,
          startRequest: run.startRequest,
          task: run.task
        },
        definitionDigest: admission.definitionDigest,
        projectBindingRevision: admission.projectBindingRevision,
        inputDigest,
        workspaceSelector: admission.workspaceSelector,
        executionDeadlineAt: admission.executionDeadlineAt,
        workflowContext: admission.workflowContext
      },
      task: {
        id: task.id,
        run_id: task.run_id,
        company_id: task.company_id,
        agent_id: task.agent_id,
        workspace_selector: task.workspace_selector,
        run_scope: task.run_scope
      },
      bindingRef: binding.data.bindingRef,
      commandFingerprint: binding.data.commandFingerprint
    })
  }
}
