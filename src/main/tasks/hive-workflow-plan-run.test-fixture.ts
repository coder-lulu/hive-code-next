import { z } from 'zod'
import { createHash, randomUUID } from 'node:crypto'
import { vi } from 'vitest'
import { workflowPlanGraphFixture } from '../../shared/hive-workflow-plan-runs.test-fixture'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import {
  hiveWorkflowPlanGraphContext,
  hiveWorkflowPlanGraphPrompt
} from '../../shared/hive-workflow-plan-graph-context'
import { createHiveWorkflowPlanRunFacade } from './hive-workflow-plan-run-facade'
import { taskCommand } from './task-execution.test-fixture'
import { workflowPrepareBindingCommit } from './local-task-workflow-prepare-service.test-fixture'
import { HiveRuntimeAdapterBinding, type HiveRuntimeBinding } from './paperclip-adapter-contract'

export function planRunFixture() {
  const f = workflowPlanGraphFixture(),
    original = f.source.caseView,
    graph = f.view.graph!,
    startedAt = Date.now()
  graph.startedAt = new Date(startedAt).toISOString()
  graph.deadlineAt = new Date(startedAt + graph.maxDurationMs).toISOString()
  const { admission, view } = f
  admission.executionDeadlineAt = graph.deadlineAt
  admission.workspaceSelector = f.source.team.project.workspaceSelector
  admission.payloadFingerprint = digest({
    operation: 'plans.run.start',
    input: admission.startRequest
  })
  view.runs.push(admission.run)
  view.tasks[0].latestRun = admission.run.task
  view.tasks[0].taskRevision = 1
  admission.workflowContext = hiveWorkflowPlanGraphContext(
    original,
    view,
    admission.run.proposalTaskRef,
    admission.run.task
  )
  admission.input = hiveWorkflowPlanGraphPrompt(
    original,
    view,
    admission.run.proposalTaskRef,
    admission.workflowContext
  )
  admission.inputDigest = createHash('sha256').update(JSON.stringify(admission.input)).digest('hex')
  const refs = {
    projectId: view.projectId,
    caseId: view.caseId,
    applicationRef: view.application.applicationRef,
    taskId: admission.run.task.taskId,
    runId: admission.run.task.runId
  }
  const task = {
    id: refs.taskId,
    run_id: refs.runId,
    company_id: admission.run.task.spaceId,
    agent_id: admission.run.employeeRef,
    title: 'Plan task',
    status: 'todo',
    status_version: 1,
    binding: HiveRuntimeAdapterBinding.nullable().parse(null),
    result_receipt: null,
    cancel_requested: false,
    driver_kind: 'hive_runtime',
    run_status: 'queued',
    checkout_run_id: null,
    execution_locked_at: null,
    execution_run_id: refs.runId,
    execution_stage: null,
    run_scope: {
      kind: 'workbenchPlan',
      ...refs,
      graphRef: graph.graphRef,
      proposalTaskRef: admission.run.proposalTaskRef,
      workspaceRef: original.team.project.hiveWorkspaceRef
    }
  }
  const { bindingCommit, bindingWrite } = workflowPrepareBindingCommit(task, view.tasks[0])
  let current = true,
    workspaceCurrent = true,
    enforcementCurrent = true,
    hostCurrent = true
  const assertCurrent = () => {
    if (!current) {
      throw new Error('FORBIDDEN')
    }
  }
  const assertHostCurrent = () => {
    if (!hostCurrent) {
      throw new Error('FORBIDDEN')
    }
  }
  const request = vi.fn(async (path: string, body?: unknown): Promise<unknown> => {
    if (path.endsWith('/graph-read')) {
      return structuredClone(view)
    }
    if (path.endsWith('/run-read')) {
      return structuredClone(admission)
    }
    if (path.endsWith('/binding')) {
      return bindingCommit(HiveRuntimeAdapterBinding.parse(body))
    }
    if (
      path.endsWith('/graph-start') ||
      path.endsWith('/graph-cancel') ||
      path.endsWith('/graph-retry') ||
      path.endsWith('/graph-resume')
    ) {
      const operation = path.split('/graph-')[1]
      return {
        admission: {
          requestId: z.object({ requestId: z.string() }).parse(body).requestId,
          payloadFingerprint: digest({ operation: `plans.graph.${operation}`, input: body }),
          replayed: false
        },
        view
      }
    }
    if (path.endsWith(`/runs/${refs.runId}`)) {
      return structuredClone(task)
    }
    throw new Error(`Unexpected request ${path}`)
  })
  const binding: HiveRuntimeBinding = {
    bindingRef: 'binding:plan-test',
    paperclipCompanyId: task.company_id,
    paperclipAgentId: task.agent_id,
    command: taskCommand({ task: admission.run.task }),
    commandFingerprint: 'a'.repeat(64)
  }
  const issuer = { issue: vi.fn(async () => binding) }
  const options = {
    context: async () => ({
      accountRef: original.team.company.ownerAccountRef,
      request,
      assertCurrent
    }),
    getWorkflowCase: vi.fn(async () => structuredClone(original)),
    getTeam: vi.fn(async () => structuredClone(f.source.team)),
    validateWorkspace: vi.fn(async () => ({
      workspaceRef: original.team.project.hiveWorkspaceRef,
      assertCurrent() {
        if (!workspaceCurrent) {
          throw new Error('FORBIDDEN')
        }
      }
    })),
    enforcement: vi.fn(async () => ({
      assertCurrent() {
        if (!enforcementCurrent) {
          throw new Error('FORBIDDEN')
        }
      }
    })),
    issuer
  }
  const service = createHiveWorkflowPlanRunFacade(options)
  const start = {
    projectId: refs.projectId,
    caseId: refs.caseId,
    applicationRef: refs.applicationRef,
    requestId: randomUUID(),
    expectedCaseRevision: original.revision,
    expectedProjectRevision: original.projectBindingRevision,
    draftDigest: view.application.draftDigest,
    proposalDigest: view.application.proposalDigest,
    requestedDurationMs: graph.maxDurationMs
  }
  return {
    ...f,
    refs,
    original,
    task,
    binding,
    options,
    request,
    issuer,
    bindingCommit,
    bindingWrite,
    ...service,
    start,
    assertHostCurrent,
    prepare: () => service.preparePlanRun(refs, assertHostCurrent),
    revoke: (kind: string) => {
      if (kind === 'account') {
        current = false
      }
      if (kind === 'workspace') {
        workspaceCurrent = false
      }
      if (kind === 'enforcement') {
        enforcementCurrent = false
      }
      if (kind === 'host') {
        hostCurrent = false
      }
    }
  }
}
