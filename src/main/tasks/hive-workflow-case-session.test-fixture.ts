import { randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import {
  HiveWorkflowCaseReadQuerySchema,
  HiveWorkflowCaseViewSchema
} from '../../shared/hive-workflow-cases'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseRunAdmissionSchema } from '../../shared/hive-workflow-case-runs'
import type { HiveWorkflowCaseView } from '../../shared/hive-workflow-cases'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { caseSessionNativeFixture } from './hive-workflow-case-session-native.test-fixture'
import {
  TaskExecutionRecordSchema,
  taskExecutionIdentity,
  type TaskExecutionRecord
} from './task-execution-record'
import {
  createHiveWorkflowCaseSessionFacade,
  type HiveWorkflowCaseSessionSource
} from './hive-workflow-case-session-facade'
import { refuseTaskExecution } from './task-execution-error'
import type { HiveTaskServiceRowSchema } from './hive-task-service-row'
import type { HiveRuntimeBinding } from './paperclip-adapter-contract'

export function workflowCaseSessionFixture(
  role: HiveWorkflowCaseView['stageTasks'][number]['role'] = 'product'
) {
  const accountId = 'case-session-fixture',
    data = workflowCaseFixture(accountId)
  let view = data.view
  const stage = view.stageTasks.find((item) => item.role === role)!
  const {
    command,
    context,
    input,
    inputDigest,
    record: originalRecord,
    session: originalSession
  } = caseSessionNativeFixture(view, role)
  let record: TaskExecutionRecord | null = originalRecord
  let session: AgentSessionRecord | null = originalSession
  const startRequest = {
    requestId: randomUUID(),
    projectId: data.team.project.id,
    caseId: view.id,
    expectedCaseRevision: 1,
    stageRef: stage.stageRef,
    expectedTaskRevision: 0
  }
  let admission = HiveWorkflowCaseRunAdmissionSchema.parse({
    requestId: startRequest.requestId,
    payloadFingerprint: digest({ operation: 'cases.start', input: startRequest }),
    replayed: true,
    run: {
      caseId: view.id,
      stageRef: stage.stageRef,
      role,
      employeeRef: stage.employeeRef,
      startRequest,
      task: command.task,
      title: 'Original stage',
      status: 'unknown',
      artifactRefs: []
    },
    definitionDigest: view.definitionDigest,
    projectBindingRevision: view.projectBindingRevision,
    input,
    inputDigest,
    workspaceSelector: 'folder:source',
    executionDeadlineAt: command.executionDeadlineAt,
    workflowContext: context
  })
  let task: ReturnType<typeof HiveTaskServiceRowSchema.parse> & {
    binding: HiveRuntimeBinding | null
  } = {
    id: stage.taskId,
    run_id: command.task.runId,
    title: 'Original stage',
    status: 'in_progress',
    status_version: 1,
    company_id: data.team.company.id,
    agent_id: stage.employeeRef,
    cancel_requested: false,
    execution_stage: 'outcome_unknown',
    workspace_selector: admission.workspaceSelector,
    run_scope: {
      kind: 'workbenchCase',
      projectId: data.team.project.id,
      caseId: view.id,
      workspaceRef: command.workspaceRef
    },
    binding: {
      bindingRef: 'original-case-binding',
      paperclipCompanyId: data.team.company.id,
      paperclipAgentId: stage.employeeRef,
      command,
      commandFingerprint: record.commandFingerprint
    },
    result_receipt: record.result
  }
  let owner: HiveWorkflowCaseSessionSource['currentRuntime'] extends () => infer T ? T : never = {
    runtimeRecordId: command.runtimeRecordId,
    ownershipEpoch: command.ownershipEpoch,
    accountId
  }
  let current = true,
    sourceCurrent = true,
    workspaceCurrent = true
  const deny = (value: boolean) => {
    if (!value) {
      refuseTaskExecution('FORBIDDEN')
    }
  }
  const history = {
    ok: true as const,
    page: {
      sessionId: session.sessionId,
      epoch: 'original-epoch',
      direction: 'tail' as const,
      items: [],
      submissions: [],
      removedItemIds: [],
      window: { oldest: null, newest: null, nextCursor: { epoch: 'original-epoch', sequence: 0 } },
      liveCursor: { epoch: 'original-epoch', sequence: 1 },
      hasOlder: false,
      hasNewer: false
    }
  }
  const reads: string[] = []
  let onRequest = (_path: string) => undefined
  const source: HiveWorkflowCaseSessionSource = {
    currentRuntime: () => owner,
    assertCurrent: () => deny(sourceCurrent),
    readExecution: vi.fn(() => record),
    readSession: vi.fn(() => session),
    validateWorkspace: vi.fn(async () => ({ assertCurrent: () => deny(workspaceCurrent) })),
    readHistory: vi.fn(async (_id, _page, guard) => {
      guard()
      return history
    }),
    assertHistoryCurrent: vi.fn(() => undefined)
  }
  const query = {
    projectId: data.team.project.id,
    caseId: view.id,
    taskId: stage.taskId,
    runId: command.task.runId,
    direction: 'tail' as const
  }
  const facade = (selected: HiveWorkflowCaseSessionSource | null = source) =>
    createHiveWorkflowCaseSessionFacade({
      source: selected,
      context: async () => ({
        accountRef: data.view.team.company.ownerAccountRef,
        assertCurrent: () => deny(current),
        async request(path) {
          reads.push(path)
          onRequest(path)
          return path.endsWith('/run-read') ? admission : task
        }
      }),
      getWorkflowCase: async (value) => {
        HiveWorkflowCaseReadQuerySchema.parse(value)
        reads.push('case')
        onRequest('case')
        return view
      }
    })
  const settle = (status: 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown' | 'running') => {
    const original = record!,
      result = ['succeeded', 'failed', 'cancelled'].includes(status)
        ? {
            ...taskExecutionIdentity(command),
            kind: 'execution.result',
            commandFingerprint: original.commandFingerprint,
            recordedAt: new Date(TASK_TEST_NOW).toISOString(),
            receiptId: 'synthetic-original-result',
            outcomeRef: 'synthetic-outcome',
            status,
            artifactRefs: [],
            usageFactRefs: [],
            stopProof: {
              proofRef: 'synthetic-stop',
              evidenceKind: 'stopped',
              managedToolsSettled: true,
              writersFenced: true,
              recordedAt: new Date(TASK_TEST_NOW).toISOString()
            }
          }
        : null
    record = TaskExecutionRecordSchema.parse({
      ...original,
      revision: original.revision + 1,
      status,
      result,
      dispatch: 'bound',
      launch: {
        worktreeId: original.workspace.workspaceId,
        outcome: { kind: 'structured', sessionId: session!.sessionId, handle: 'synthetic-handle' },
        receipt: {
          mode: 'structured',
          preferred: 'structured',
          reason: 'user_default',
          detail: 'Synthetic original'
        }
      },
      events: [
        ...original.events,
        {
          ...original.events[0],
          eventId: `event:${original.events.length + 1}`,
          sequence: original.events.length + 1,
          status
        }
      ]
    })
    task = { ...task, result_receipt: record.result }
    admission = {
      ...admission,
      run: { ...admission.run, status: status === 'outcome_unknown' ? 'unknown' : status }
    }
  }
  return {
    query,
    source,
    reads,
    history,
    facade,
    settle,
    get view() {
      return view
    },
    set view(value) {
      view = HiveWorkflowCaseViewSchema.parse(value)
    },
    get record() {
      return record
    },
    set record(value) {
      record = value
    },
    get session() {
      return session
    },
    set session(value) {
      session = value
    },
    get task() {
      return task
    },
    set task(value) {
      task = value
    },
    get admission() {
      return admission
    },
    set admission(value) {
      admission = value
    },
    get owner() {
      return owner
    },
    set owner(value) {
      owner = value
    },
    get current() {
      return current
    },
    set current(value) {
      current = value
    },
    get sourceCurrent() {
      return sourceCurrent
    },
    set sourceCurrent(value) {
      sourceCurrent = value
    },
    get workspaceCurrent() {
      return workspaceCurrent
    },
    set workspaceCurrent(value) {
      workspaceCurrent = value
    },
    get onRequest() {
      return onRequest
    },
    set onRequest(value) {
      onRequest = value
    }
  }
}
