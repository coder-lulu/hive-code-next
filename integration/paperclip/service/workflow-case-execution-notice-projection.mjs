import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { HiveWorkflowCaseExecutionNoticeSchema } from '../../../src/shared/hive-workflow-case-execution-notices.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { WorkflowRunInputSchema } from './workflow-case-run-records.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

const blocked = z.strictObject({
  kind: z.literal('hive.workflow.admission_blocked'),
  reason: HiveWorkflowCaseExecutionNoticeSchema.shape.reason.exclude(['native_not_started']),
  stageRef: z.string().min(1).max(160),
  causeRunId: z.string().uuid()
})
const notStarted = z.strictObject({
  kind: z.literal('hive.workflow.stage_unavailable'),
  reason: z.literal('native_not_started'),
  stageRef: z.string().min(1).max(160)
})

/** Projects stopped native facts from the original event log; no control state is created. */
export async function readWorkflowCaseExecutionNotices(db, accountId, view, consumed) {
  const rows =
    await db`SELECT e.id,e.company_id,e.case_id,e.actor_type,e.actor_agent_id,e.run_id,e.payload,e.created_at
    FROM pipeline_case_events e
    WHERE e.company_id=${view.binding.scope.companyRef} AND e.case_id=${view.id} AND e.type='updated'
      AND e.payload->>'kind' IN ('hive.workflow.admission_blocked','hive.workflow.stage_unavailable')
    ORDER BY e.created_at,e.id LIMIT 97 FOR SHARE OF e`
  if (rows.length > 96) {
    refuse('REVISION_CONFLICT')
  }
  const notices = []
  for (const event of rows) {
    const [native] =
      await db`SELECT b.account_id,b.task_id,b.binding,b.workflow_input,b.result_receipt,
      h.agent_id,h.company_id AS run_company_id,h.status AS run_status,h.execution_stage,h.result_json
      FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id
      WHERE b.account_id=${accountId} AND b.run_id=${event.run_id} FOR SHARE OF b,h`
    if (!native) {
      refuse('REVISION_CONFLICT')
    }
    const row = { ...event, ...native }
    const payload = z.union([blocked, notStarted]).safeParse(row.payload)
    const binding = HiveRuntimeAdapterBinding.safeParse(row.binding)
    const input = WorkflowRunInputSchema.safeParse(row.workflow_input)
    const receipt = TaskExecutionResultSchema.safeParse(row.result_receipt)
    if (!payload.success || !binding.success || !input.success || !receipt.success) {
      refuse('REVISION_CONFLICT')
    }
    const context = input.data.workflowContext,
      command = binding.data.command
    const source = view.stageTasks.find((task) => task.stageRef === input.data.stageRef)
    if (
      row.account_id !== accountId ||
      row.company_id !== view.binding.scope.companyRef ||
      row.case_id !== view.id ||
      row.run_company_id !== row.company_id ||
      row.actor_type !== 'agent' ||
      !source ||
      !context ||
      row.actor_agent_id !== source.employeeRef ||
      row.agent_id !== source.employeeRef ||
      row.task_id !== source.taskId ||
      context.employeeRef !== source.employeeRef ||
      context.role !== source.role ||
      input.data.caseId !== view.id ||
      input.data.stageRef !== context.stageRef ||
      digest(context.binding) !== digest(view.binding) ||
      context.definitionDigest !== view.definitionDigest ||
      digest(command.workflowContext) !== digest(context) ||
      digest(command.task) !== digest(input.data.task) ||
      command.task.spaceId !== row.company_id ||
      command.task.taskId !== row.task_id ||
      command.task.runId !== row.run_id ||
      binding.data.paperclipCompanyId !== row.company_id ||
      binding.data.paperclipAgentId !== row.agent_id ||
      digest(command.ownerScope) !== digest(view.team.company.ownerScope) ||
      command.executionAccountRef !== view.team.company.ownerAccountRef ||
      command.workspaceRef !== view.team.project.hiveWorkspaceRef ||
      command.executionDeadlineAt !== input.data.executionDeadlineAt ||
      receipt.data.commandFingerprint !== binding.data.commandFingerprint ||
      [
        'protocolVersion',
        'runtimeRecordId',
        'ownershipEpoch',
        'executionId',
        'executionEpoch'
      ].some((key) => receipt.data[key] !== command[key]) ||
      row.run_status !== receipt.data.status ||
      row.execution_stage !== 'settled' ||
      digest(row.result_json) !== digest(receipt.data) ||
      !view.stageTasks.some((task) => task.stageRef === payload.data.stageRef)
    ) {
      refuse('REVISION_CONFLICT')
    }
    if (payload.data.kind === 'hive.workflow.stage_unavailable') {
      if (
        payload.data.stageRef !== source.stageRef ||
        receipt.data.status !== 'failed' ||
        receipt.data.stopProof.evidenceKind !== 'not_started'
      ) {
        refuse('REVISION_CONFLICT')
      }
    } else {
      const accepted = consumed.find(
        (item) => item.asset.outcome.producer.task.runId === row.run_id
      )
      if (
        !accepted ||
        payload.data.causeRunId !== row.run_id ||
        receipt.data.stopProof.evidenceKind !== 'stopped' ||
        (accepted.handoff
          ? accepted.handoff.consumer.stageRef !== payload.data.stageRef
          : accepted.review || source.stageRef !== payload.data.stageRef)
      ) {
        refuse('REVISION_CONFLICT')
      }
    }
    notices.push(
      HiveWorkflowCaseExecutionNoticeSchema.parse({
        kind: 'workflow.case-execution-notice',
        eventRef: row.id,
        stageRef: payload.data.stageRef,
        causeRunId: row.run_id,
        reason: payload.data.reason,
        recordedAt: new Date(row.created_at).toISOString()
      })
    )
  }
  return notices
}
