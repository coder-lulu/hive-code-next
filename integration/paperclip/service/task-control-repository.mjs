import { z } from 'zod'
import { taskDeliveryBinding, refuseTaskRepository as refuse } from './task-delivery-repository.mjs'

export function requireExternalTaskScope(task, expected) {
  if (
    task.driver_kind !== 'hive_runtime' ||
    (expected && (task.company_id !== expected.companyId || task.run_id !== expected.runId))
  ) {
    refuse('FORBIDDEN')
  }
}

/** Core controls resolve the account from private persisted identity, never request JSON. */
export function createTaskControlRepository(sql, read) {
  return {
    async resolveExternalExecution(companyId, runId) {
      z.string().uuid().parse(companyId)
      z.string().uuid().parse(runId)
      const rows = await sql`SELECT b.account_id,b.task_id FROM hive_task_bindings b
        JOIN issues i ON i.id=b.task_id
        JOIN heartbeat_runs h ON h.id=b.run_id AND h.company_id=i.company_id
        JOIN hive_task_accounts a ON a.account_id=b.account_id AND a.company_id=i.company_id
        JOIN agents g ON g.id=a.agent_id AND g.company_id=i.company_id
        WHERE i.company_id=${companyId} AND h.id=${runId} AND h.driver_kind='hive_runtime'
          AND h.agent_id=a.agent_id AND i.assignee_agent_id=a.agent_id`
      if (rows.length !== 1) {
        refuse('FORBIDDEN')
      }
      const row = rows[0]
      const task = await read(sql, row.account_id, row.task_id)
      requireExternalTaskScope(task, { companyId, runId })
      taskDeliveryBinding(task)
      return { accountId: row.account_id, taskId: row.task_id, companyId, runId }
    }
  }
}
