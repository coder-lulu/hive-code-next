import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { workflowPlanApplicationFixture } from '../../shared/hive-workflow-plan-application.test-fixture'
import { canonicalAgentSessionDigest as digest } from '../../shared/agent-session-mutation-envelope'
import { createHiveWorkflowPlanApplicationFacade } from './hive-workflow-plan-application-facade'
import { workflowPlanHistoricalApplicationFixture } from '../../shared/hive-workflow-plan-application-source.test-fixture'

function fixture() {
  const data = workflowPlanApplicationFixture()
  let current = true
  const request = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => data.view)
  const getWorkflowCase = vi.fn(async () => data.caseView)
  const facade = createHiveWorkflowPlanApplicationFacade({
    context: async () => ({
      accountRef: data.caseView.team.company.ownerAccountRef,
      assertCurrent() {
        if (!current) {
          throw new Error('FORBIDDEN')
        }
      },
      request
    }),
    getWorkflowCase
  })
  const reply = (replayed = false) => ({
    admission: {
      requestId: data.input.requestId,
      payloadFingerprint: digest({ operation: 'plans.apply', input: data.input }),
      replayed
    },
    view: data.view
  })
  return {
    ...data,
    facade,
    request,
    getWorkflowCase,
    reply,
    revoke() {
      current = false
    },
    query: {
      projectId: data.input.projectId,
      caseId: data.input.caseId,
      draftRef: data.input.draftRef
    }
  }
}

describe('authenticated original plan materialization facade', () => {
  it('reads the exact original draft without issuing execution or workspace commands', async () => {
    const f = fixture()
    expect(await f.facade.getWorkflowPlanApplication(f.query)).toEqual(f.view)
    expect(f.request.mock.calls).toEqual([['/hive/workbench/plans/read', f.query]])
  })
  it('normalizes UUID requests before hashing and sending the narrow mutation', async () => {
    const f = fixture()
    f.request.mockResolvedValue(f.reply())
    expect(
      await f.facade.applyWorkflowPlan({
        ...f.input,
        projectId: f.input.projectId.toUpperCase(),
        caseId: f.input.caseId.toUpperCase(),
        requestId: f.input.requestId.toUpperCase()
      })
    ).toEqual(f.reply())
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/plans/apply', f.input)
  })
  it('accepts original receipt replay after the Case advances', async () => {
    const f = fixture()
    f.caseView.revision += 1
    f.view.caseRevision = f.caseView.revision
    f.request.mockResolvedValue(f.reply(true))
    expect((await f.facade.applyWorkflowPlan(f.input)).view.application).toEqual(f.receipt)
  })
  it('retains the first receipt for a different request ID applying the same original plan', async () => {
    const f = fixture(),
      originalId = f.receipt.requestId
    f.input.requestId = randomUUID()
    f.request.mockResolvedValue(f.reply(true))
    expect((await f.facade.applyWorkflowPlan(f.input)).view.application?.requestId).toBe(originalId)
  })
  it('rejects a foreign Case or absent draft before any service mutation', async () => {
    const f = fixture()
    await expect(f.facade.applyWorkflowPlan({ ...f.input, caseId: randomUUID() })).rejects.toThrow(
      'FORBIDDEN'
    )
    await expect(
      f.facade.applyWorkflowPlan({ ...f.input, draftRef: 'absent-draft' })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
  })
  it('rejects changed source bytes and plan revisions before service mutation', async () => {
    const f = fixture()
    for (const input of [
      { ...f.input, draftDigest: 'a'.repeat(64) },
      { ...f.input, planRevision: 2 }
    ]) {
      await expect(f.facade.applyWorkflowPlan(input)).rejects.toThrow('REVISION_CONFLICT')
    }
    expect(f.request).not.toHaveBeenCalled()
  })
  it('rechecks account authority after source lookup and after mutation completion', async () => {
    const f = fixture()
    f.getWorkflowCase.mockImplementation(async () => {
      f.revoke()
      return f.caseView
    })
    await expect(f.facade.getWorkflowPlanApplication(f.query)).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
    const g = fixture()
    g.request.mockImplementation(async () => {
      g.revoke()
      return g.reply()
    })
    await expect(g.facade.applyWorkflowPlan(g.input)).rejects.toThrow('FORBIDDEN')
  })
  it.each([
    'request',
    'fingerprint',
    'employee',
    'binding',
    'parent',
    'source',
    'scope',
    'revision'
  ])('refuses forged %s in an otherwise valid service response', async (kind) => {
    const f = fixture(),
      response = f.reply()
    const receipt = response.view.application!
    if (kind === 'request') {
      response.admission.requestId = randomUUID()
    }
    if (kind === 'fingerprint') {
      response.admission.payloadFingerprint = 'a'.repeat(64)
    }
    if (kind === 'employee') {
      receipt.createdTaskRefs[0].employeeRef = randomUUID()
    }
    if (kind === 'binding') {
      receipt.projectBindingRevision += 1
    }
    if (kind === 'parent') {
      receipt.parentTaskRef = randomUUID()
    }
    if (kind === 'source') {
      receipt.draftDigest = 'a'.repeat(64)
    }
    if (kind === 'scope') {
      response.view.projectId = randomUUID()
    }
    if (kind === 'revision') {
      response.view.caseRevision += 1
    }
    f.request.mockResolvedValue(response)
    await expect(f.facade.applyWorkflowPlan(f.input)).rejects.toThrow()
  })
})

describe('historical receipt behind a newer authenticated plan', () => {
  it.each(['valid', 'revision', 'missing-task', 'dependencies'])(
    'authenticates %s against the original applied draft',
    async (kind) => {
      const f = workflowPlanHistoricalApplicationFixture()
      if (kind === 'revision') {
        f.receipt.planRevision = 99
      }
      if (kind === 'missing-task') {
        f.receipt.createdTaskRefs.pop()
        f.view.taskStates.pop()
      }
      if (kind === 'dependencies') {
        f.receipt.createdTaskRefs[1].dependsOnTaskIds = []
      }
      const facade = createHiveWorkflowPlanApplicationFacade({
        context: async () => ({
          accountRef: f.caseView.team.company.ownerAccountRef,
          assertCurrent() {},
          request: async () => f.view
        }),
        getWorkflowCase: async () => f.caseView
      })
      if (kind === 'valid') {
        expect(await facade.getWorkflowPlanApplication(f.query)).toEqual(f.view)
      } else {
        await expect(facade.getWorkflowPlanApplication(f.query)).rejects.toThrow(
          'REVISION_CONFLICT'
        )
      }
    }
  )
})
