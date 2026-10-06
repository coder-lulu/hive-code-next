import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalAgentSessionDigest as digest } from '../../../src/shared/agent-session-mutation-envelope.ts'
import { WorkflowNativeOutcomeAssetSchema } from '../../../src/shared/task-workflow/workflow-native-outcome.ts'
import {
  WorkflowHandoffSchema,
  WorkflowReviewSchema,
  WorkflowRoleExecutionSchema
} from '../../../src/shared/task-workflow/workflow-evidence.ts'
import { TaskExecutionResultSchema } from '../../../src/shared/task-execution/task-execution-receipts.ts'
import { HiveRuntimeAdapterBinding } from '../../../src/main/tasks/paperclip-adapter-contract.ts'
import { WorkflowRunInputSchema } from './workflow-case-run-records.mjs'
import { refuseWorkbench as refuse } from './team-workbench-repository-records.mjs'

export const WorkflowCaseOutcomeConsumedPayloadSchema = z.strictObject({
  kind: z.literal('hive.workflow.outcome_consumed'),
  asset: WorkflowNativeOutcomeAssetSchema,
  handoff: WorkflowHandoffSchema.optional(),
  review: WorkflowReviewSchema.optional()
})

export function workflowRoleExecutionForAsset(rawAsset) {
  const { context, producer } = WorkflowNativeOutcomeAssetSchema.parse(rawAsset).outcome
  return WorkflowRoleExecutionSchema.parse({
    employeeRef: context.employeeRef,
    role: context.role,
    task: producer.task,
    runtimeRecordId: producer.runtimeRecordId,
    ownershipEpoch: producer.ownershipEpoch,
    executionId: producer.executionId,
    executionEpoch: producer.executionEpoch,
    commandFingerprint: producer.commandFingerprint,
    sessionRef: producer.sessionRef,
    executionWorkspaceRef: producer.executionWorkspaceId,
    workspaceExecutionClaimRef: producer.workspaceExecutionClaimRef
  })
}

export function validateWorkflowCaseEvidenceEvent(row, accountId, view) {
  const payload = WorkflowCaseOutcomeConsumedPayloadSchema.safeParse(row.payload)
  const binding = HiveRuntimeAdapterBinding.safeParse(row.binding)
  const input = WorkflowRunInputSchema.safeParse(row.workflow_input)
  const receipt = TaskExecutionResultSchema.safeParse(row.result_receipt)
  if (!payload.success || !binding.success || !input.success || !receipt.success) {
    refuse('REVISION_CONFLICT')
  }
  const { asset, handoff, review } = payload.data
  const { context, producer, artifacts } = asset.outcome
  const command = binding.data.command
  const fixed = view.stageTasks.find((task) => task.stageRef === context.stageRef)
  const expected = workflowRoleExecutionForAsset(asset)
  const acceptedBusiness =
    producer.status === 'succeeded' ||
    (context.role === 'tester' &&
      producer.status === 'failed' &&
      review &&
      review.decision !== 'approved')
  const outputName = {
    product: 'requirements.md',
    developer: 'implementation.md',
    tester: 'test-report.md',
    ops: 'release-plan.md'
  }[context.role]
  const versionDigest = createHash('sha256').update(JSON.stringify(asset.outcome)).digest('hex')
  if (
    row.company_id !== view.binding.scope.companyRef ||
    row.case_id !== view.id ||
    row.actor_type !== 'agent' ||
    row.actor_agent_id !== context.employeeRef ||
    row.run_id !== producer.task.runId ||
    row.account_id !== accountId ||
    row.run_agent_id !== context.employeeRef ||
    row.run_company_id !== view.binding.scope.companyRef ||
    row.task_id !== fixed?.taskId ||
    fixed.employeeRef !== context.employeeRef ||
    fixed.role !== context.role ||
    binding.data.paperclipCompanyId !== view.binding.scope.companyRef ||
    binding.data.paperclipAgentId !== fixed.employeeRef ||
    command.executionPolicy.trustMode !== 'enforced_autonomous' ||
    command.workspaceRef !== view.team.project.hiveWorkspaceRef ||
    digest(command.ownerScope) !== digest(view.team.company.ownerScope) ||
    command.executionAccountRef !== view.team.company.ownerAccountRef ||
    row.run_status !== receipt.data.status ||
    row.execution_stage !== 'settled' ||
    receipt.data.stopProof.evidenceKind !== 'stopped' ||
    producer.status !== receipt.data.status ||
    producer.resultDigest !== digest(receipt.data) ||
    producer.outcomeRef !== receipt.data.outcomeRef ||
    digest(row.result_json) !== digest(receipt.data) ||
    digest(context.binding) !== digest(view.binding) ||
    context.definitionDigest !== view.definitionDigest ||
    digest(context) !== digest(input.data.workflowContext) ||
    input.data.caseId !== view.id ||
    digest(producer.task) !== digest(input.data.task) ||
    digest(producer.task) !== digest(command.task) ||
    producer.commandFingerprint !== binding.data.commandFingerprint ||
    producer.operationId !== command.operationId ||
    producer.workspaceRef !== command.workspaceRef ||
    producer.executionAccountRef !== view.team.company.ownerAccountRef ||
    digest(producer.ownerScope) !== digest(view.team.company.ownerScope) ||
    producer.workspaceExecutionClaimRef !== command.workspaceExecutionClaimRef ||
    producer.writeFence !== command.writeFence ||
    command.executionDeadlineAt !== input.data.executionDeadlineAt ||
    asset.version.digest !== versionDigest ||
    asset.version.artifactRef !== `artifact:${versionDigest}` ||
    ['protocolVersion', 'runtimeRecordId', 'ownershipEpoch', 'executionId', 'executionEpoch'].some(
      (key) => producer[key] !== command[key] || producer[key] !== receipt.data[key]
    ) ||
    artifacts.some((item) => !receipt.data.artifactRefs.includes(item.version.artifactRef)) ||
    (handoff &&
      (digest(handoff.binding) !== digest(view.binding) ||
        handoff.stageRef !== context.stageRef ||
        digest(handoff.producer) !== digest(expected) ||
        !acceptedBusiness ||
        !artifacts.some(
          (item) => item.name === outputName && digest(item.version) === digest(handoff.artifact)
        ) ||
        digest({ value: handoff.codeVersion }) !== digest({ value: asset.outcome.codeVersion }))) ||
    (review &&
      (digest(review.binding) !== digest(view.binding) ||
        review.stageRef !== context.stageRef ||
        context.role !== 'tester' ||
        !acceptedBusiness ||
        (review.decision === 'approved' && asset.outcome.commands.kind !== 'available') ||
        digest(review.reviewer) !== digest(expected) ||
        digest({ value: review.codeVersion }) !== digest({ value: context.codeInput?.version }) ||
        !artifacts.some(
          (item) =>
            item.name === 'test-report.md' && digest(item.version) === digest(review.testReport)
        )))
  ) {
    refuse('REVISION_CONFLICT')
  }
  return { eventId: row.id, ...payload.data }
}

export async function readWorkflowCaseConsumedEvidence(db, accountId, view) {
  const rows =
    await db`SELECT e.id,e.company_id,e.case_id,e.actor_type,e.actor_agent_id,e.run_id,e.payload
    FROM pipeline_case_events e
    WHERE e.company_id=${view.binding.scope.companyRef} AND e.case_id=${view.id}
      AND e.type='updated' AND e.payload->>'kind'='hive.workflow.outcome_consumed'
    ORDER BY e.created_at,e.id LIMIT 97 FOR SHARE OF e`
  if (rows.length > 96 || new Set(rows.map((row) => row.run_id)).size !== rows.length) {
    refuse('REVISION_CONFLICT')
  }
  const evidence = []
  for (const row of rows) {
    const [producer] =
      await db`SELECT b.task_id,b.account_id,b.binding,b.workflow_input,b.result_receipt,
      h.company_id AS run_company_id,h.agent_id AS run_agent_id,h.status AS run_status,h.execution_stage,h.result_json
      FROM hive_task_bindings b JOIN heartbeat_runs h ON h.id=b.run_id
      WHERE b.run_id=${row.run_id} AND b.account_id=${accountId} FOR SHARE OF b,h`
    if (!producer) {
      refuse('REVISION_CONFLICT')
    }
    evidence.push(validateWorkflowCaseEvidenceEvent({ ...row, ...producer }, accountId, view))
  }
  return evidence
}

export async function readWorkflowCaseEvidence(db, accountId, view) {
  const evidence = await readWorkflowCaseConsumedEvidence(db, accountId, view)
  return {
    handoffs: evidence.flatMap((item) => (item.handoff ? [item.handoff] : [])),
    reviews: evidence.flatMap((item) => (item.review ? [item.review] : []))
  }
}
