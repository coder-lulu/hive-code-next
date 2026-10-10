import { z } from 'zod'
import { requireTaskRepositoryScope, taskDeliveryBinding } from './task-delivery-repository.mjs'
import { readWorkflowCaseRun } from './workflow-case-run-records.mjs'
import {
  readPlanGraphSource,
  readPlanGraphRows,
  planRunAdmission
} from './workflow-plan-graph-records.mjs'

const Page = z.strictObject({
  after: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(32)
})

export function createTaskDispatchRecoveryRepository(sql, read) {
  return {
    async listRecoverableRuns(accountId, rawQuery = {}) {
      requireTaskRepositoryScope(accountId)
      const query = Page.parse(rawQuery)
      const rows = await sql.begin(async (db) => {
        return db`SELECT i.id,i.company_id,h.agent_id,b.run_id,b.binding,r.case_id,m.application_id,
          (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,
          h.status AS run_status,h.execution_stage,d.generation,d.lease_ref,d.owner_id,d.expires_at
        FROM hive_task_bindings b JOIN issues i ON i.id=b.task_id
        JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=i.company_id
        JOIN agents g ON g.id=h.agent_id AND g.company_id=i.company_id
        LEFT JOIN hive_task_accounts a ON a.account_id=b.account_id
        LEFT JOIN hive_workflow_case_stage_issues r ON r.issue_id=i.id
        LEFT JOIN hive_workflow_plan_application_tasks m ON m.issue_id=i.id
        LEFT JOIN hive_task_deliveries d ON d.task_id=b.task_id AND d.account_id=b.account_id AND d.run_id=b.run_id
        WHERE b.account_id=${accountId} AND b.result_receipt IS NULL
          AND (b.binding IS NOT NULL OR (m.application_id IS NOT NULL AND b.workflow_input IS NOT NULL AND h.status='queued' AND h.execution_stage IS NULL) OR (r.case_id IS NOT NULL AND b.workflow_input IS NOT NULL
            AND h.status='queued' AND h.execution_stage IS NULL AND NOT b.cancel_requested
            AND h.context_snapshot->'externalExecutionControl'->'cancel' IS NULL))
          AND (r.case_id IS NOT NULL OR m.application_id IS NOT NULL OR (a.company_id=i.company_id AND a.agent_id=h.agent_id))
          AND h.driver_kind='hive_runtime' AND (${query.after ?? null}::uuid IS NULL OR b.run_id>${query.after ?? null}::uuid)
        ORDER BY b.run_id ASC LIMIT ${query.limit + 1}`
      })
      const items = []
      for (const candidate of rows.slice(0, query.limit)) {
        try {
          // Release one Case's pipeline locks before reading a different workflow.
          const item = await sql.begin(async (db) => {
            const task =
              candidate.case_id == null && candidate.application_id == null
                ? candidate
                : await read(db, accountId, candidate.id, candidate.run_id)
            let prepareRefs
            if (task.binding) {
              taskDeliveryBinding(task)
            } else {
              const plan = task.run_scope?.kind === 'workbenchPlan'
              if (plan) {
                const source = await readPlanGraphSource(db, accountId, task.run_scope)
                const admission = planRunAdmission(
                  source,
                  await readPlanGraphRows(db, accountId, source),
                  task.id,
                  task.run_id
                )
                if (!['pending', 'cancelRequested'].includes(admission.run.status)) {
                  return undefined
                }
                prepareRefs = {
                  projectId: task.run_scope.projectId,
                  caseId: task.run_scope.caseId,
                  applicationRef: task.run_scope.applicationRef,
                  taskId: task.id,
                  runId: task.run_id
                }
              } else {
                const record = await readWorkflowCaseRun(
                  db,
                  accountId,
                  candidate.id,
                  candidate.run_id
                )
                if (
                  record.run.status !== 'pending' ||
                  task.run_scope?.kind !== 'workbenchCase' ||
                  task.cancel_requested
                ) {
                  return undefined
                }
                prepareRefs = {
                  projectId: task.run_scope.projectId,
                  caseId: task.run_scope.caseId,
                  taskId: task.id,
                  runId: task.run_id
                }
              }
            }
            return {
              ...candidate,
              company_id: task.company_id,
              agent_id: task.agent_id,
              binding: task.binding,
              cancel_requested: task.cancel_requested,
              run_status: task.run_status,
              execution_stage: task.execution_stage,
              ...(task.run_scope ? { run_scope: task.run_scope } : {}),
              ...(prepareRefs ? { prepareRefs } : {})
            }
          })
          if (item && (item.binding || item.prepareRefs)) {
            items.push(item)
          }
        } catch (error) {
          if (
            ![
              'FORBIDDEN',
              'REVISION_CONFLICT',
              'CAPABILITY_UNAVAILABLE',
              'OUTCOME_UNKNOWN'
            ].includes(error.code)
          ) {
            throw error
          }
          console.warn('HIVE_TASK_RECOVERY_UNAVAILABLE', candidate.run_id, error.code)
        }
      }
      return {
        items,
        nextCursor: rows.length > query.limit ? rows[query.limit - 1].run_id : null
      }
    }
  }
}
