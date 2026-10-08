import type { Store } from '../persistence'
import type { getStructuredAgentSessionResources } from '../runtime/structured-agent-session-runtime'
import { createPassiveAgentSessionHistoryReader } from '../native-chat/agent-session-journal/journal-passive-history'
import type { HiveWorkflowCaseSessionSource } from './hive-workflow-case-session-facade'
import { restoreLocalTaskWorkspace } from './local-task-workspace-recovery'
import { refuseTaskExecution } from './task-execution-error'

type Installed = Awaited<ReturnType<typeof getStructuredAgentSessionResources>>
export function createLocalTaskSessionInspection(options: {
  resources: {
    journalDatabase: Installed['journalDatabase']
    store: {
      getRecord: Installed['store']['getRecord']
      tasks: Pick<Installed['store']['tasks'], 'get'>
    }
  }
  store: Pick<Store, 'getFolderWorkspace'>
  currentRuntime: HiveWorkflowCaseSessionSource['currentRuntime']
  assertCurrent(): void
}): HiveWorkflowCaseSessionSource {
  const { resources, assertCurrent } = options
  const readSessionHistory = createPassiveAgentSessionHistoryReader(resources.journalDatabase)
  return {
    currentRuntime: options.currentRuntime,
    assertCurrent,
    readExecution: (identity) => resources.store.tasks.get(identity),
    readSession: resources.store.getRecord,
    assertHistoryCurrent: readSessionHistory.assertCurrent,
    validateWorkspace: (workspace) =>
      restoreLocalTaskWorkspace(workspace, {
        assertCurrent,
        getFolderWorkspace: (id) => options.store.getFolderWorkspace(id)
      }),
    readHistory(sessionId, page, guard) {
      guard()
      const session = resources.store.getRecord(sessionId)
      if (!session) {
        return refuseTaskExecution('EXECUTION_NOT_FOUND')
      }
      return readSessionHistory(
        { sessionId, workspaceId: session.location.workspaceId },
        page,
        guard
      )
    }
  }
}
