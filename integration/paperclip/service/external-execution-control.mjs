import { z } from 'zod'

export const EXTERNAL_EXECUTION_PATH =
  /^\/hive\/external-execution\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/
const Control = z.strictObject({ action: z.enum(['recover', 'cancel', 'drain']) })

/** An acknowledgement accepts an observer request; only Runtime receipts establish an outcome. */
export async function handleExternalExecutionControl(repository, dispatch, companyId, runId, body) {
  z.string().uuid().parse(companyId)
  z.string().uuid().parse(runId)
  const { action } = Control.parse(body)
  const scope = await repository.resolveExternalExecution(companyId, runId)
  await dispatch.control(scope.accountId, scope.taskId, action, { companyId, runId })
  return { accepted: true, companyId, runId, action, retained: true }
}
