import {
  HiveWorkflowCaseSessionPageSchema,
  type HiveWorkflowCaseSessionRead
} from '../../../../../shared/hive-workflow-case-session'
import { executableWorkflowCase, workflowCaseRun } from './hive-workflow-case-run.test-fixtures'

export function workflowSessionQuery(): HiveWorkflowCaseSessionRead {
  const view = executableWorkflowCase()
  const run = workflowCaseRun(view, 'succeeded')
  return {
    projectId: view.binding.scope.projectRef,
    caseId: view.id,
    taskId: run.task.taskId,
    runId: run.task.runId,
    direction: 'tail',
    limit: 40
  }
}

export function workflowSessionPage(
  query = workflowSessionQuery(),
  sequences = [41, 42],
  hasOlder = false,
  epoch = 'original-epoch'
) {
  const sessionId = 'original-session'
  const items = sequences.map((sequence) => ({
    itemId: `original-message-${sequence}`,
    sequence,
    revision: 1,
    observedAt: sequence,
    body: {
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: `Original row ${sequence}` }]
    }
  }))
  return HiveWorkflowCaseSessionPageSchema.parse({
    projectId: query.projectId,
    caseId: query.caseId,
    taskId: query.taskId,
    runId: query.runId,
    sessionId,
    workspaceId: 'original-execution-workspace',
    executionHostId: 'local',
    provider: 'codex',
    history: {
      ok: true,
      page: {
        sessionId,
        epoch,
        direction: query.direction,
        items,
        submissions: [],
        removedItemIds: [],
        hasOlder,
        hasNewer: query.direction === 'before',
        window: {
          oldest: items.length ? { epoch, sequence: items[0].sequence } : null,
          newest: items.length ? { epoch, sequence: items.at(-1)!.sequence } : null,
          nextCursor: {
            epoch,
            sequence:
              items[0]?.sequence ?? (query.direction === 'before' ? query.cursor.sequence : 0)
          }
        },
        liveCursor: { epoch, sequence: 500 }
      }
    }
  })
}
