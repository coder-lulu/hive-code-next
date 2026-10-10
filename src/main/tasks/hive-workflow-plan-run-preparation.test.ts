import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { planRunFixture } from './hive-workflow-plan-run.test-fixture'

describe('authenticated plan run preparation', () => {
  it('refuses a current project revision change on the same workspace after issue', async () => {
    const f = planRunFixture()
    f.issuer.issue.mockImplementation(async () => {
      f.source.team.project.binding.bindingRevision++
      return f.binding
    })
    await expect(f.prepare()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.bindingWrite).not.toHaveBeenCalled()
  })
  it('rechecks the committed binding against the locally issued command before acknowledging', async () => {
    const f = planRunFixture()
    const commit = f.bindingCommit.getMockImplementation()!
    f.bindingCommit.mockImplementation(async (binding) => {
      const task = await commit(binding)
      task.binding!.bindingRef = 'binding:foreign'
      return task
    })
    await expect(f.prepare()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.bindingWrite).toHaveBeenCalledOnce()
  })
  it('binds the exact queued plan run and replays without dispatch or source Case mutation', async () => {
    const f = planRunFixture(),
      before = structuredClone(f.original)
    await expect(f.prepare()).resolves.toEqual(f.refs)
    await expect(f.prepare()).resolves.toEqual(f.refs)
    expect(f.bindingWrite).toHaveBeenCalledTimes(1)
    expect(f.original).toEqual(before)
    expect(f.issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        task: f.admission.run.task,
        input: f.admission.input,
        workflowContext: f.admission.workflowContext,
        executionDeadlineAt: f.view.graph!.deadlineAt,
        executionMode: 'enforced_autonomous'
      })
    )
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/dispatch'))).toBe(false)
  })
  it.each(['account', 'workspace', 'enforcement', 'host'])(
    'rechecks %s after asynchronous issue before commit',
    async (kind) => {
      const f = planRunFixture()
      f.issuer.issue.mockImplementation(async () => {
        f.revoke(kind)
        return f.binding
      })
      await expect(f.prepare()).rejects.toThrow('FORBIDDEN')
      expect(f.bindingWrite).not.toHaveBeenCalled()
    }
  )
  it.each([
    'deadline',
    'graph',
    'revision',
    'cancel',
    'run',
    'workspace',
    'context',
    'input',
    'fingerprint',
    'source'
  ])('refuses changed %s before issuing a binding', async (kind) => {
    const f = planRunFixture()
    if (kind === 'deadline') {
      f.admission.executionDeadlineAt = new Date(Date.now() - 1).toISOString()
    }
    if (kind === 'graph') {
      f.view.graph!.status = 'paused'
    }
    if (kind === 'revision') {
      f.task.status_version++
    }
    if (kind === 'cancel') {
      f.task.cancel_requested = true
    }
    if (kind === 'run') {
      f.task.run_id = randomUUID()
    }
    if (kind === 'workspace') {
      f.task.run_scope.workspaceRef = 'workspace:foreign'
    }
    if (kind === 'context') {
      f.admission.workflowContext.handoffRefs.push('foreign:outcome')
    }
    if (kind === 'input') {
      f.admission.input = 'Forged but correctly hashed input'
      f.admission.inputDigest = createHash('sha256')
        .update(JSON.stringify(f.admission.input))
        .digest('hex')
    }
    if (kind === 'fingerprint') {
      f.admission.payloadFingerprint = 'f'.repeat(64)
    }
    if (kind === 'source') {
      f.original.requirement += ' changed'
    }
    await expect(f.prepare()).rejects.toThrow()
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })
  it('rechecks persisted cancellation and exact graph at the commit boundary', async () => {
    const f = planRunFixture()
    f.issuer.issue.mockImplementation(async () => {
      f.task.cancel_requested = true
      return f.binding
    })
    await expect(f.prepare()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.bindingWrite).not.toHaveBeenCalled()
  })
  it('binds expired queued cancellation with its original deadline and never dispatches', async () => {
    const f = planRunFixture()
    f.view.graph!.startedAt = new Date(
      Date.now() - f.view.graph!.maxDurationMs - 1000
    ).toISOString()
    f.view.graph!.deadlineAt = new Date(Date.now() - 1000).toISOString()
    f.admission.executionDeadlineAt = f.view.graph!.deadlineAt
    f.admission.run.status = 'cancelRequested'
    f.task.cancel_requested = true
    f.view.graph!.status = 'cancel_requested'
    await expect(f.prepare()).resolves.toEqual(f.refs)
    expect(f.issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({ executionDeadlineAt: f.admission.executionDeadlineAt })
    )
    expect(f.request.mock.calls.some(([path]) => path.endsWith('/dispatch'))).toBe(false)
  })
  it('does not let cancelled graph alone authorize cancellation binding', async () => {
    const f = planRunFixture()
    f.view.graph!.status = 'cancel_requested'
    await expect(f.prepare()).rejects.toThrow('REVISION_CONFLICT')
    expect(f.bindingWrite).not.toHaveBeenCalled()
  })
})
