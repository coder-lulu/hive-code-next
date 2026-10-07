import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  HiveWorkflowCaseCodePageQuerySchema,
  HiveWorkflowCaseCodeFileQuerySchema,
  HiveWorkflowCodeVersionSchema,
  type HiveWorkflowCaseCodeApi
} from '../../shared/hive-workflow-case-code'
import type { HiveWorkflowCasesApi } from '../../shared/hive-workflow-cases'
import type { TaskCodeSnapshotStore } from './task-code-snapshot'
import type { TaskExecutionPersistence } from './task-execution-store'
import type { HiveTaskRequestContext } from './hive-team-workbench-facade'
import { assertHiveWorkbenchCompanyOwner } from './hive-team-workbench-facade'
import { hiveTaskRunPath, parseHiveTaskRun } from './hive-task-service-row'
import { assertWorkflowCaseCodeProducer } from './hive-workflow-case-code-producer'
import { TaskExecutionError, refuseTaskExecution } from './task-execution-error'

export type HiveWorkflowCaseCodeSource = {
  snapshots: Pick<TaskCodeSnapshotStore, 'getCodePage' | 'getCodeFile'>
  readExecution: TaskExecutionPersistence['get']
}
export function createHiveWorkflowCaseCodeFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
  source: HiveWorkflowCaseCodeSource | null
}): HiveWorkflowCaseCodeApi {
  const read = async (
    query:
      | ReturnType<typeof HiveWorkflowCaseCodePageQuerySchema.parse>
      | ReturnType<typeof HiveWorkflowCaseCodeFileQuerySchema.parse>,
    mode: 'page' | 'file'
  ) => {
    const caller = await options.context()
    const view = await options.getWorkflowCase({ projectId: query.projectId, caseId: query.caseId })
    caller.assertCurrent()
    assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
    if (view.id !== query.caseId || view.binding.scope.projectRef !== query.projectId) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    const candidates = view.handoffs.filter((item) => item.handoffRef === query.handoffRef)
    const handoff = candidates[0]
    const version = HiveWorkflowCodeVersionSchema.safeParse(handoff?.codeVersion)
    if (
      candidates.length !== 1 ||
      !handoff ||
      handoff.producer.role !== 'developer' ||
      !version.success
    ) {
      return refuseTaskExecution('FORBIDDEN')
    }
    const source = options.source
    if (!source) {
      return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
    }
    const { task: ref } = handoff.producer
    const task = parseHiveTaskRun(
      await caller.request(hiveTaskRunPath(ref.taskId, ref.runId)),
      ref.taskId,
      ref.runId
    )
    caller.assertCurrent()
    const original = source.readExecution(handoff.producer)
    if (!original) {
      return refuseTaskExecution('EXECUTION_NOT_FOUND')
    }
    const record = structuredClone(original)
    assertWorkflowCaseCodeProducer(view, handoff, task, record, caller.accountRef)
    const recordDigest = digest(record)
    const guard = () => caller.assertCurrent()
    const assertRecordCurrent = () => {
      caller.assertCurrent()
      const current = source.readExecution(handoff.producer)
      if (!current || digest(current) !== recordDigest) {
        return refuseTaskExecution('OUTCOME_UNKNOWN')
      }
    }
    assertRecordCurrent()
    const result =
      mode === 'page' && 'limit' in query
        ? await source.snapshots.getCodePage(version.data, record, query, guard)
        : mode === 'file' && 'path' in query
          ? await source.snapshots.getCodeFile(version.data, record, query, guard)
          : refuseTaskExecution('INVALID_REQUEST')
    assertRecordCurrent()
    return result
  }
  const safeRead = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof TaskExecutionError) {
        throw error
      }
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return refuseTaskExecution('EXECUTION_NOT_FOUND')
      }
      return refuseTaskExecution('OUTCOME_UNKNOWN')
    }
  }
  return {
    getWorkflowCaseCodePage(raw) {
      const query = HiveWorkflowCaseCodePageQuerySchema.safeParse(raw)
      if (!query.success) {
        return Promise.reject(new TaskExecutionError('INVALID_REQUEST'))
      }
      return safeRead(async () => {
        const value = await read(query.data, 'page')
        if (!('files' in value)) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return value
      })
    },
    getWorkflowCaseCodeFile(raw) {
      const query = HiveWorkflowCaseCodeFileQuerySchema.safeParse(raw)
      if (!query.success) {
        return Promise.reject(new TaskExecutionError('INVALID_REQUEST'))
      }
      return safeRead(async () => {
        const value = await read(query.data, 'file')
        if (!('file' in value)) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return value
      })
    }
  }
}
