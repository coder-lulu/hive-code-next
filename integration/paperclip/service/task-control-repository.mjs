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
export function createTaskControlRepository(sql, read, resolve) {
  return {
    async resolveExternalExecution(companyId, runId) {
      z.string().uuid().parse(companyId)
      z.string().uuid().parse(runId)
      return sql.begin(async (db) => {
        const task = await resolve(db, companyId, runId)
        if (task.run_scope.kind === 'personal' && task.assignee_agent_id !== task.agent_id) {
          refuse('FORBIDDEN')
        }
        requireExternalTaskScope(task, { companyId, runId })
        taskDeliveryBinding(task)
        return { accountId: task.account_id, taskId: task.id, companyId, runId }
      })
    }
  }
}
