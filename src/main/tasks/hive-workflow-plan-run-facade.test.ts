import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createHiveWorkflowPlanRunFacade } from './hive-workflow-plan-run-facade'
import { planRunFixture } from './hive-workflow-plan-run.test-fixture'

describe('authenticated plan graph facade', () => {
  it('resumes only through the authenticated mutation with native preflight and exact fingerprint', async () => {
    const f = planRunFixture()
    f.view.graph!.status = 'paused'
    const input = {
      projectId: f.refs.projectId,
      caseId: f.refs.caseId,
      applicationRef: f.refs.applicationRef,
      requestId: randomUUID(),
      graphRef: f.view.graph!.graphRef,
      expectedGraphRevision: f.view.graph!.revision
    }
    await expect(f.facade.resumeWorkflowPlanGraph(input)).resolves.toHaveProperty('view', f.view)
    expect(f.options.enforcement).toHaveBeenCalled()
    expect(f.options.validateWorkspace).toHaveBeenCalled()
    expect(f.request).toHaveBeenLastCalledWith('/hive/workbench/plans/graph-resume', input)
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })
  it.each(['account', 'workspace', 'enforcement'])(
    'refuses resume with revoked %s before service mutation',
    async (kind) => {
      const f = planRunFixture()
      f.revoke(kind)
      await expect(
        f.facade.resumeWorkflowPlanGraph({
          projectId: f.refs.projectId,
          caseId: f.refs.caseId,
          applicationRef: f.refs.applicationRef,
          requestId: randomUUID(),
          graphRef: f.view.graph!.graphRef,
          expectedGraphRevision: f.view.graph!.revision
        })
      ).rejects.toThrow('FORBIDDEN')
      expect(f.request).not.toHaveBeenCalled()
    }
  )
  it('rejects current project binding changes before queueing', async () => {
    const f = planRunFixture()
    f.source.team.project.binding.bindingRevision++
    await expect(f.facade.startWorkflowPlanGraph(f.start)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.request).not.toHaveBeenCalled()
  })
  it('admits graph through public control plane without binding or dispatch', async () => {
    const f = planRunFixture()
    const result = await f.facade.startWorkflowPlanGraph(f.start)
    expect(result.view).toEqual(f.view)
    expect(f.issuer.issue).not.toHaveBeenCalled()
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      '/hive/workbench/plans/graph-read',
      '/hive/workbench/plans/graph-start'
    ])
    expect(f.facade).not.toHaveProperty('preparePlanRun')
    expect(f.facade).not.toHaveProperty('getWorkflowPlanRunAdmission')
  })
  it.each(['account', 'workspace', 'enforcement'])(
    'refuses revoked %s before queueing',
    async (kind) => {
      const f = planRunFixture()
      f.revoke(kind)
      await expect(f.facade.startWorkflowPlanGraph(f.start)).rejects.toThrow('FORBIDDEN')
      expect(f.request).not.toHaveBeenCalled()
    }
  )
  it('requires enforcement before queueing', async () => {
    const f = planRunFixture()
    const service = createHiveWorkflowPlanRunFacade({ ...f.options, enforcement: undefined })
    await expect(service.facade.startWorkflowPlanGraph(f.start)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(f.request).not.toHaveBeenCalled()
  })
  it('rejects a foreign source Case before service mutation', async () => {
    const f = planRunFixture()
    await expect(
      f.facade.startWorkflowPlanGraph({ ...f.start, caseId: randomUUID() })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
  })
  it('refuses a forged fingerprint after the authenticated graph response', async () => {
    const f = planRunFixture()
    f.request.mockImplementation(async (path) =>
      path.endsWith('/graph-read')
        ? f.view
        : {
            view: f.view,
            admission: {
              requestId: f.start.requestId,
              payloadFingerprint: 'f'.repeat(64),
              replayed: false
            }
          }
    )
    await expect(f.facade.startWorkflowPlanGraph(f.start)).rejects.toThrow('REVISION_CONFLICT')
  })
  it('retains cancellation during unavailable enforcement', async () => {
    const f = planRunFixture()
    f.revoke('enforcement')
    await expect(
      f.facade.cancelWorkflowPlanGraph({
        projectId: f.refs.projectId,
        caseId: f.refs.caseId,
        applicationRef: f.refs.applicationRef,
        requestId: randomUUID(),
        graphRef: f.view.graph!.graphRef,
        expectedGraphRevision: f.view.graph!.revision
      })
    ).resolves.toHaveProperty('view', f.view)
    expect(f.options.enforcement).not.toHaveBeenCalled()
  })
})
