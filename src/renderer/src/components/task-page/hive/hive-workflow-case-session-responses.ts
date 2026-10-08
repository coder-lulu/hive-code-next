import {
  HiveWorkflowCaseSessionPageSchema,
  type HiveWorkflowCaseSessionPage,
  type HiveWorkflowCaseSessionRead
} from '../../../../../shared/hive-workflow-case-session'

export function workflowCaseSessionKey(
  query: Pick<HiveWorkflowCaseSessionRead, 'projectId' | 'caseId' | 'taskId' | 'runId'>
) {
  return JSON.stringify([query.projectId, query.caseId, query.taskId, query.runId])
}

export function readWorkflowCaseSessionPage(
  value: unknown,
  query: HiveWorkflowCaseSessionRead,
  original: Pick<HiveWorkflowCaseSessionPage, 'sessionId' | 'workspaceId'> | null
) {
  const parsed = HiveWorkflowCaseSessionPageSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('INVALID_RESPONSE')
  }
  const result = parsed.data
  const { history } = result
  const page = history.page
  if (
    workflowCaseSessionKey(result) !== workflowCaseSessionKey(query) ||
    (original &&
      (result.sessionId !== original.sessionId || result.workspaceId !== original.workspaceId)) ||
    (history.ok && page.direction !== query.direction) ||
    (history.ok &&
      query.direction === 'before' &&
      (page.epoch !== query.cursor.epoch ||
        (page.liveCursor && query.cursor.sequence > page.liveCursor.sequence) ||
        page.items.some((item) => item.sequence >= query.cursor.sequence) ||
        (page.hasOlder && !page.items.length))) ||
    (page.hasOlder && !page.window.oldest)
  ) {
    throw new Error('INVALID_RESPONSE')
  }
  return result
}
