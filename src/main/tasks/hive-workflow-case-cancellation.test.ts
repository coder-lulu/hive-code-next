import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { hiveWorkflowStagePrompt } from '../../shared/hive-workflow-stage-prompt'
import { hiveWorkflowStageContext } from '../../shared/hive-workflow-stage-context'
import { prepareWorkflowCaseCancellation } from './hive-workflow-case-cancellation'
import { taskCommand } from './task-execution.test-fixture'

function fixture() {
  const f = workflowCaseFixture(),
    fixed = f.view.stageTasks[0],
    runId = randomUUID()
  const startRequest = {
    requestId: randomUUID(),
    projectId: f.input.projectId,
    caseId: f.view.id,
    expectedCaseRevision: 1,
    stageRef: fixed.stageRef,
    expectedTaskRevision: 0
  }
  const task = {
    spaceId: f.team.company.id,
    taskId: fixed.taskId,
    runId,
    attempt: 1,
    taskRevision: '1'
  }
  const input = hiveWorkflowStagePrompt(f.view, fixed.stageRef)
  const admission = {
    requestId: startRequest.requestId,
    payloadFingerprint: digest({ operation: 'cases.start', input: startRequest }),
    replayed: true,
    run: {
      caseId: f.view.id,
      stageRef: fixed.stageRef,
      role: fixed.role,
      employeeRef: fixed.employeeRef,
      startRequest,
      task,
      title: 'Product',
      status: 'cancelRequested',
      artifactRefs: []
    },
    input,
    inputDigest: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    definitionDigest: f.view.definitionDigest,
    projectBindingRevision: f.view.projectBindingRevision,
    workspaceSelector: f.team.project.workspaceSelector,
    executionDeadlineAt: new Date(Date.now() + 60_000).toISOString(),
    workflowContext: hiveWorkflowStageContext(f.view, fixed.stageRef)
  }
  const request = vi.fn(async (path: string): Promise<unknown> =>
    path.endsWith('/run-read')
      ? admission
      : {
          id: fixed.taskId,
          run_id: runId,
          company_id: task.spaceId,
          agent_id: fixed.employeeRef,
          title: 'Product',
          status: 'in_progress',
          status_version: 2,
          cancel_requested: true,
          result_receipt: null
        }
  )
  const issuer = {
    issue: vi.fn(async () => ({
      bindingRef: 'binding:prestart-cancel',
      paperclipCompanyId: task.spaceId,
      paperclipAgentId: fixed.employeeRef,
      command: taskCommand({ task }),
      commandFingerprint: 'a'.repeat(64)
    }))
  }
  const options = {
    caller: { accountRef: f.view.team.company.ownerAccountRef, assertCurrent: vi.fn(), request },
    issuer,
    validateWorkspace: vi.fn(async () => ({
      workspaceRef: f.team.project.binding.hiveWorkspaceRef,
      assertCurrent() {}
    })),
    taskId: fixed.taskId,
    runId,
    projectId: f.input.projectId,
    caseId: f.view.id,
    companyId: task.spaceId,
    employeeRef: fixed.employeeRef,
    workspaceRef: f.team.project.binding.hiveWorkspaceRef
  }
  return { ...f, admission, options, request, issuer }
}

describe('cancellation before a workflow binding exists', () => {
  it('completes the original cancelled binding and never sends a start dispatch', async () => {
    const f = fixture()
    await prepareWorkflowCaseCancellation(f.options)
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      '/hive/workbench/cases/run-read',
      `/hive/tasks/${f.options.taskId}/runs/${f.options.runId}/binding`
    ])
    expect(f.issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        task: f.admission.run.task,
        input: f.admission.input,
        executionMode: 'enforced_autonomous',
        executionDeadlineAt: f.admission.executionDeadlineAt,
        workflowContext: f.admission.workflowContext
      })
    )
  })
  it.each([
    'employee',
    'workspace',
    'status',
    'input',
    'project',
    'request',
    'fingerprint'
  ] as const)('rejects changed %s before issuing a binding', async (boundary) => {
    const f = fixture()
    if (boundary === 'employee') {
      f.admission.run.employeeRef = randomUUID()
    }
    if (boundary === 'workspace') {
      f.options.workspaceRef = 'workspace:foreign'
    }
    if (boundary === 'status') {
      f.admission.run.status = 'running'
    }
    if (boundary === 'input') {
      f.admission.input = 'Changed private input'
    }
    if (boundary === 'project') {
      f.admission.run.startRequest.projectId = randomUUID()
    }
    if (boundary === 'request') {
      f.admission.requestId = randomUUID()
    }
    if (boundary === 'fingerprint') {
      f.admission.payloadFingerprint = 'b'.repeat(64)
    }
    await expect(prepareWorkflowCaseCancellation(f.options)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.issuer.issue).not.toHaveBeenCalled()
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/binding'))).toBe(false)
  })
})
