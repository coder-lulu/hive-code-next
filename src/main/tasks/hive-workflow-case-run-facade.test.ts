import { randomUUID, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { hiveWorkflowStagePrompt } from '../../shared/hive-workflow-stage-prompt'
import type { HiveWorkflowCaseRun } from '../../shared/hive-workflow-case-runs'
import { createHiveWorkflowCaseRunFacade } from './hive-workflow-case-run-facade'
import { TaskExecutionError } from './task-execution-error'
import { taskCommand } from './task-execution.test-fixture'

function fixture() {
  const f = workflowCaseFixture(),
    task = f.view.stageTasks[0]
  const input = {
    requestId: randomUUID(),
    projectId: f.input.projectId,
    caseId: f.view.id,
    expectedCaseRevision: 1,
    stageRef: task.stageRef,
    expectedTaskRevision: 0
  }
  const run: HiveWorkflowCaseRun = {
    caseId: f.view.id,
    stageRef: task.stageRef,
    role: task.role,
    employeeRef: task.employeeRef,
    task: {
      spaceId: f.team.company.id,
      taskId: task.taskId,
      runId: randomUUID(),
      attempt: 1,
      taskRevision: '1'
    },
    startRequest: input,
    title: 'Product requirement',
    status: 'pending',
    artifactRefs: []
  }
  const prompt = hiveWorkflowStagePrompt(f.view, task.stageRef)
  let admission = {
    requestId: input.requestId,
    payloadFingerprint: digest({ operation: 'cases.start', input }),
    replayed: false,
    run,
    definitionDigest: f.view.definitionDigest,
    projectBindingRevision: f.view.projectBindingRevision,
    input: prompt,
    inputDigest: createHash('sha256').update(JSON.stringify(prompt)).digest('hex'),
    workspaceSelector: f.team.project.workspaceSelector,
    executionDeadlineAt: new Date(Date.now() + 60_000).toISOString()
  }
  let current = true,
    workspaceCurrent = true,
    enforcementCurrent = true
  const assertCurrent = () => {
    if (!current) {
      throw new TaskExecutionError('FORBIDDEN')
    }
  }
  const request = vi.fn(async (path: string): Promise<unknown> => {
    if (path.endsWith('/cases/start')) {
      return admission
    }
    if (path.endsWith('/cases/runs')) {
      return [admission.run]
    }
    if (path.endsWith('/binding')) {
      return {
        id: run.task.taskId,
        run_id: run.task.runId,
        company_id: run.task.spaceId,
        agent_id: run.employeeRef,
        title: run.title,
        status: 'in_progress',
        status_version: 2,
        result_receipt: null,
        cancel_requested: false
      }
    }
    if (path.endsWith('/dispatch')) {
      return { accepted: true }
    }
    throw new Error('Unexpected path')
  })
  const issuer = {
    issue: vi.fn(async () => ({
      bindingRef: 'binding:case-run',
      paperclipCompanyId: run.task.spaceId,
      paperclipAgentId: run.employeeRef,
      command: taskCommand({ task: run.task }),
      commandFingerprint: 'a'.repeat(64)
    }))
  }
  const enforcement = vi.fn(async () => ({
    assertCurrent() {
      if (!enforcementCurrent) {
        throw new TaskExecutionError('CAPABILITY_UNAVAILABLE')
      }
    }
  }))
  const options = {
    context: async () => ({
      accountRef: f.view.team.company.ownerAccountRef,
      assertCurrent,
      request
    }),
    getWorkflowCase: vi.fn(async () => f.view),
    workspaceSelector: vi.fn(async () => f.team.project.workspaceSelector),
    validateWorkspace: vi.fn(async () => ({
      workspaceRef: f.view.team.project.hiveWorkspaceRef,
      assertCurrent() {
        if (!workspaceCurrent) {
          throw new TaskExecutionError('REVISION_CONFLICT')
        }
      }
    })),
    issuer,
    enforcement
  }
  return {
    ...f,
    input,
    run,
    prompt,
    issuer,
    request,
    enforcement,
    options,
    facade: createHiveWorkflowCaseRunFacade(options),
    setAdmission(value: typeof admission) {
      admission = value
    },
    admission: () => admission,
    revoke() {
      current = false
    },
    replaceWorkspace() {
      workspaceCurrent = false
    },
    revokeEnforcement() {
      enforcementCurrent = false
    }
  }
}

describe('authenticated workflow run dispatch through the original Task binding', () => {
  it('issues the fixed role an enforced command after admission, then binds before dispatch', async () => {
    const f = fixture()
    expect(await f.facade.startWorkflowCase(f.input)).toEqual(f.run)
    expect(f.issuer.issue).toHaveBeenCalledWith({
      paperclipCompanyId: f.run.task.spaceId,
      paperclipAgentId: f.run.employeeRef,
      task: f.run.task,
      workspaceSelector: f.team.project.workspaceSelector,
      input: f.prompt,
      executionMode: 'enforced_autonomous',
      executionDeadlineAt: f.admission().executionDeadlineAt
    })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      '/hive/workbench/cases/start',
      `/hive/tasks/${f.run.task.taskId}/runs/${f.run.task.runId}/binding`,
      `/hive/tasks/${f.run.task.taskId}/runs/${f.run.task.runId}/dispatch`
    ])
  })
  it.each(['running', 'unknown', 'cancelRequested', 'succeeded', 'failed', 'cancelled'] as const)(
    'observes a replayed %s run without issuing or dispatching another execution',
    async (status) => {
      const f = fixture(),
        admission = f.admission()
      f.setAdmission({ ...admission, replayed: true, run: { ...f.run, status } })
      expect((await f.facade.startWorkflowCase(f.input)).status).toBe(status)
      expect(f.issuer.issue).not.toHaveBeenCalled()
      expect(f.request).toHaveBeenCalledTimes(1)
    }
  )
  it('denies unavailable enforcement before writing any run', async () => {
    const f = fixture()
    f.enforcement.mockRejectedValue(new TaskExecutionError('CAPABILITY_UNAVAILABLE'))
    await expect(f.facade.startWorkflowCase(f.input)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
    expect(f.request).not.toHaveBeenCalled()
    expect(f.issuer.issue).not.toHaveBeenCalled()
    await expect(
      createHiveWorkflowCaseRunFacade({ ...f.options, enforcement: undefined }).startWorkflowCase(
        f.input
      )
    ).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  })
  it.each([
    'case',
    'employee',
    'task',
    'stage',
    'digest',
    'workspace',
    'prompt',
    'request'
  ] as const)('rejects swapped private admission %s before binding', async (boundary) => {
    const f = fixture(),
      admission = structuredClone(f.admission())
    if (boundary === 'case') {
      admission.run.startRequest.caseId = admission.run.caseId = randomUUID()
    }
    if (boundary === 'employee') {
      admission.run.employeeRef = randomUUID()
    }
    if (boundary === 'task') {
      admission.run.task.taskId = randomUUID()
    }
    if (boundary === 'stage') {
      admission.run.startRequest.stageRef = admission.run.stageRef = 'stage:foreign'
    }
    if (boundary === 'digest') {
      admission.definitionDigest = 'b'.repeat(64)
    }
    if (boundary === 'workspace') {
      admission.workspaceSelector = 'folder:foreign'
    }
    if (boundary === 'request') {
      admission.requestId = randomUUID()
    }
    if (boundary === 'prompt') {
      admission.input = 'Changed instruction'
      admission.inputDigest = createHash('sha256')
        .update(JSON.stringify(admission.input))
        .digest('hex')
    }
    f.setAdmission(admission)
    await expect(f.facade.startWorkflowCase(f.input)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })
  it.each(['account', 'workspace', 'enforcement'] as const)(
    'rechecks %s after admission and before binding',
    async (boundary) => {
      const f = fixture()
      f.request.mockImplementation(async () => {
        if (boundary === 'account') {
          f.revoke()
        }
        if (boundary === 'workspace') {
          f.replaceWorkspace()
        }
        if (boundary === 'enforcement') {
          f.revokeEnforcement()
        }
        return f.admission()
      })
      await expect(f.facade.startWorkflowCase(f.input)).rejects.toThrow()
      expect(f.issuer.issue).not.toHaveBeenCalled()
    }
  )
  it('reuses the frozen prompt of a recovered pending admission after requirement edits', async () => {
    const f = fixture(),
      admission = f.admission()
    f.view.requirement = 'A later business edit'
    f.setAdmission({ ...admission, replayed: true })
    await f.facade.startWorkflowCase(f.input)
    expect(f.issuer.issue).toHaveBeenCalledWith(expect.objectContaining({ input: f.prompt }))
  })
  it('validates historical fixed role and duplicate run identity on read', async () => {
    const f = fixture(),
      query = { projectId: f.input.projectId, caseId: f.view.id }
    expect(await f.facade.getWorkflowCaseRuns(query)).toEqual([f.run])
    f.request.mockResolvedValue([f.run, f.run])
    await expect(f.facade.getWorkflowCaseRuns(query)).rejects.toThrow('REVISION_CONFLICT')
    f.request.mockResolvedValue([{ ...f.run, employeeRef: randomUUID() }])
    await expect(f.facade.getWorkflowCaseRuns(query)).rejects.toThrow('REVISION_CONFLICT')
  })
})
