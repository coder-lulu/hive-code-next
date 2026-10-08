import {
  HiveWorkflowCaseSessionReadSchema,
  HiveWorkflowCaseSessionPageSchema,
  type HiveWorkflowCaseSessionPage
} from '../../shared/hive-workflow-case-session'
import {
  HiveWorkflowCaseViewSchema,
  type HiveWorkflowCasesApi
} from '../../shared/hive-workflow-cases'
import { HiveWorkflowCaseRunAdmissionSchema } from '../../shared/hive-workflow-case-runs'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import type { AgentSessionHistoryResult } from '../../shared/agent-session-wire'
import type { TaskExecutionPersistence } from './task-execution-store'
import type { TaskExecutionWorkspace } from './task-execution-record'
import {
  assertHiveWorkbenchCompanyOwner,
  type HiveTaskRequestContext
} from './hive-team-workbench-facade'
import type { LocalTaskRuntimeOwner } from './local-task-binding-options'
import { HiveRuntimeAdapterBinding } from './paperclip-adapter-contract'
import { hiveTaskRunPath, parseHiveTaskRun } from './hive-task-service-row'
import {
  AgentSessionPassiveJournalError,
  type PassiveJournalHistoryRequest
} from '../native-chat/agent-session-journal/journal-passive-history'
import {
  workflowCaseSessionIdentity,
  workflowSessionNativeIdentity,
  assertWorkflowSessionOwner
} from './hive-workflow-case-session-identity'
import { TaskExecutionError, refuseTaskExecution } from './task-execution-error'

export type HiveWorkflowCaseSessionSource = {
  currentRuntime(): LocalTaskRuntimeOwner | null
  assertCurrent(): void
  readExecution: TaskExecutionPersistence['get']
  readSession(sessionId: string): AgentSessionRecord | null
  validateWorkspace(
    workspace: TaskExecutionWorkspace
  ): { assertCurrent(): void } | Promise<{ assertCurrent(): void }>
  readHistory(
    sessionId: string,
    page: PassiveJournalHistoryRequest,
    assertCurrent: () => void
  ): Promise<AgentSessionHistoryResult>
  assertHistoryCurrent(history: AgentSessionHistoryResult): void
}

export function createHiveWorkflowCaseSessionFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getWorkflowCase: HiveWorkflowCasesApi['getWorkflowCase']
  source: HiveWorkflowCaseSessionSource | null
}) {
  return {
    async getWorkflowCaseSessionPage(raw: unknown): Promise<HiveWorkflowCaseSessionPage> {
      const query = HiveWorkflowCaseSessionReadSchema.safeParse(raw)
      if (!query.success) {
        return refuseTaskExecution('INVALID_REQUEST')
      }
      const { direction, limit, ...scope } = query.data
      const refs = {
        projectId: scope.projectId,
        caseId: scope.caseId,
        taskId: scope.taskId,
        runId: scope.runId
      }
      try {
        const source = options.source
        if (!source) {
          return refuseTaskExecution('CAPABILITY_UNAVAILABLE')
        }
        const caller = await options.context()
        const owner = structuredClone(
          assertWorkflowSessionOwner(source.currentRuntime(), caller.accountRef)
        )
        const baseGuard = () => {
          caller.assertCurrent()
          source.assertCurrent()
          const current = assertWorkflowSessionOwner(source.currentRuntime(), caller.accountRef)
          if (
            current.runtimeRecordId !== owner.runtimeRecordId ||
            current.ownershipEpoch !== owner.ownershipEpoch ||
            current.accountId !== owner.accountId
          ) {
            return refuseTaskExecution('FORBIDDEN')
          }
        }
        baseGuard()
        const readCase = async (guard: () => void) => {
          const value = await options.getWorkflowCase({
            projectId: refs.projectId,
            caseId: refs.caseId
          })
          guard()
          const view = HiveWorkflowCaseViewSchema.parse(value)
          assertHiveWorkbenchCompanyOwner(view.team.company, caller.accountRef)
          if (view.id !== refs.caseId || view.binding.scope.projectRef !== refs.projectId) {
            return refuseTaskExecution('REVISION_CONFLICT')
          }
          return view
        }
        const readAdmission = async (guard: () => void) => {
          const value = await caller.request('/hive/workbench/cases/run-read', refs)
          guard()
          const admission = HiveWorkflowCaseRunAdmissionSchema.parse(value)
          return admission
        }
        const readTask = async (guard: () => void) => {
          const value = await caller.request(hiveTaskRunPath(refs.taskId, refs.runId))
          guard()
          const task = parseHiveTaskRun(value, refs.taskId, refs.runId)
          return task
        }
        const view = await readCase(baseGuard),
          admission = await readAdmission(baseGuard),
          task = await readTask(baseGuard)
        const binding = task.binding
        const parsed = HiveRuntimeAdapterBinding.safeParse(binding)
        if (!parsed.success) {
          return refuseTaskExecution('EXECUTION_NOT_FOUND')
        }
        const record = source.readExecution(parsed.data.command)
        if (!record) {
          return refuseTaskExecution('EXECUTION_NOT_FOUND')
        }
        const sessionId = record.structuredBinding?.sessionId
        if (!sessionId) {
          return refuseTaskExecution('EXECUTION_NOT_FOUND')
        }
        const identity = workflowCaseSessionIdentity({
          view,
          admission,
          task,
          record,
          session: source.readSession(sessionId),
          owner,
          accountRef: caller.accountRef,
          refs
        })
        const guard = () => {
          baseGuard()
          const current = source.readExecution(parsed.data.command)
          if (!current) {
            return refuseTaskExecution('EXECUTION_NOT_FOUND')
          }
          if (
            workflowSessionNativeIdentity(
              current,
              source.readSession(sessionId),
              owner,
              caller.accountRef
            ) !== identity.native
          ) {
            return refuseTaskExecution('REVISION_CONFLICT')
          }
        }
        guard()
        const workspace = await source.validateWorkspace(record.workspace)
        guard()
        const originalReadGuard = () => {
          guard()
          workspace.assertCurrent()
        }
        originalReadGuard()
        const history = await source.readHistory(
          sessionId,
          { direction, limit, ...('cursor' in query.data ? { cursor: query.data.cursor } : {}) },
          originalReadGuard
        )
        const readGuard = () => {
          originalReadGuard()
          source.assertHistoryCurrent(history)
        }
        readGuard()
        const currentView = await readCase(readGuard),
          currentAdmission = await readAdmission(readGuard),
          currentTask = await readTask(readGuard)
        const currentRecord = source.readExecution(parsed.data.command)
        if (!currentRecord) {
          return refuseTaskExecution('EXECUTION_NOT_FOUND')
        }
        const currentIdentity = workflowCaseSessionIdentity({
          view: currentView,
          admission: currentAdmission,
          task: currentTask,
          record: currentRecord,
          session: source.readSession(sessionId),
          owner,
          accountRef: caller.accountRef,
          refs
        })
        if (
          currentIdentity.native !== identity.native ||
          currentIdentity.service !== identity.service
        ) {
          return refuseTaskExecution('REVISION_CONFLICT')
        }
        const page = HiveWorkflowCaseSessionPageSchema.safeParse({
          ...refs,
          sessionId,
          workspaceId: record.workspace.workspaceId,
          executionHostId: 'local',
          provider: 'codex',
          history
        })
        readGuard()
        if (
          !page.success ||
          (page.data.history.ok && page.data.history.page.direction !== direction)
        ) {
          return refuseTaskExecution('OUTCOME_UNKNOWN')
        }
        return page.data
      } catch (error) {
        if (error instanceof TaskExecutionError) {
          throw error
        }
        if (error instanceof AgentSessionPassiveJournalError) {
          return refuseTaskExecution(
            error.code === 'missing'
              ? 'EXECUTION_NOT_FOUND'
              : error.code === 'capacity'
                ? 'CAPACITY_EXCEEDED'
                : error.code === 'changed'
                  ? 'OUTCOME_UNKNOWN'
                  : 'SERVICE_UNAVAILABLE'
          )
        }
        return refuseTaskExecution('SERVICE_UNAVAILABLE')
      }
    }
  }
}
