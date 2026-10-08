import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HiveWorkflowCaseSessionPageSchema } from '../../shared/hive-workflow-case-session'
import { AgentSessionPassiveJournalError } from '../native-chat/agent-session-journal/journal-passive-history'
import { workflowCaseSessionFixture } from './hive-workflow-case-session.test-fixture'

describe('authorized original Case session history', () => {
  it.each(['product', 'developer', 'tester', 'ops'] as const)(
    'reads only the original %s session through strict Case scope',
    async (role) => {
      const f = workflowCaseSessionFixture(role)
      f.settle('succeeded')
      const before = structuredClone({
        record: f.record,
        session: f.session,
        task: f.task,
        admission: f.admission
      })
      const page = await f.facade().getWorkflowCaseSessionPage(f.query)
      expect(HiveWorkflowCaseSessionPageSchema.safeParse(page).success).toBe(true)
      expect(page.sessionId).toBe(f.session!.sessionId)
      expect(page.workspaceId).toBe(f.record!.workspace.workspaceId)
      expect(f.source.readHistory).toHaveBeenCalledTimes(1)
      expect(f.reads).toEqual([
        'case',
        '/hive/workbench/cases/run-read',
        `/hive/tasks/${f.query.taskId}/runs/${f.query.runId}`,
        'case',
        '/hive/workbench/cases/run-read',
        `/hive/tasks/${f.query.taskId}/runs/${f.query.runId}`
      ])
      expect({
        record: f.record,
        session: f.session,
        task: f.task,
        admission: f.admission
      }).toEqual(before)
    }
  )
  it.each(['failed', 'cancelled', 'outcome_unknown', 'running'] as const)(
    'retains %s history without writer/deadline/Docker admission',
    async (status) => {
      const f = workflowCaseSessionFixture()
      f.settle(status)
      expect(f.session!.lease.claimStatus).toBe('released')
      expect(f.session!.lease.unreconciled).toBe(true)
      expect(f.record!.dockerIdentity).toBeUndefined()
      expect(Date.parse(f.record!.command.expiresAt)).toBeLessThan(Date.now())
      expect(Date.parse(f.record!.command.executionDeadlineAt!)).toBeLessThan(Date.now())
      const page = await f.facade().getWorkflowCaseSessionPage(f.query)
      expect(page.history.ok).toBe(true)
      expect(f.record!.status).toBe(status)
    }
  )
  it.each(['projectId', 'caseId', 'taskId', 'runId'] as const)(
    'rejects substituted %s before history',
    async (field) => {
      const f = workflowCaseSessionFixture()
      await expect(
        f.facade().getWorkflowCaseSessionPage({ ...f.query, [field]: randomUUID() })
      ).rejects.toThrow('REVISION_CONFLICT')
      expect(f.source.readHistory).not.toHaveBeenCalled()
    }
  )
  it('requires the original retained Task binding and session', async () => {
    for (const missing of ['source', 'record', 'session', 'binding'] as const) {
      const f = workflowCaseSessionFixture()
      if (missing === 'record') {
        f.record = null
      }
      if (missing === 'session') {
        f.session = null
      }
      if (missing === 'binding') {
        f.task.binding = null
      }
      await expect(
        f.facade(missing === 'source' ? null : f.source).getWorkflowCaseSessionPage(f.query)
      ).rejects.toThrow(missing === 'source' ? 'CAPABILITY_UNAVAILABLE' : 'EXECUTION_NOT_FOUND')
      expect(f.source.readHistory).not.toHaveBeenCalled()
    }
  })
  it.each(['account', 'runtime', 'epoch', 'current', 'source', 'workspace'] as const)(
    'rejects current %s access loss during journal read',
    async (mutation) => {
      const f = workflowCaseSessionFixture()
      vi.mocked(f.source.readHistory).mockImplementation(async (_id, _page, guard) => {
        if (mutation === 'account') {
          f.owner = { ...f.owner!, accountId: 'foreign' }
        }
        if (mutation === 'runtime') {
          f.owner = { ...f.owner!, runtimeRecordId: 'foreign-runtime' }
        }
        if (mutation === 'epoch') {
          f.owner = { ...f.owner!, ownershipEpoch: f.owner!.ownershipEpoch + 1 }
        }
        if (mutation === 'current') {
          f.current = false
        }
        if (mutation === 'source') {
          f.sourceCurrent = false
        }
        if (mutation === 'workspace') {
          f.workspaceCurrent = false
        }
        guard()
        return f.history
      })
      await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow('FORBIDDEN')
    }
  )
  it.each([
    'source',
    'location',
    'home',
    'provider',
    'native',
    'employee',
    'input',
    'context',
    'workspaceSelector'
  ] as const)('rejects original %s substitution before journal read', async (mutation) => {
    const f = workflowCaseSessionFixture()
    if (mutation === 'source') {
      f.session!.taskSource = undefined
    }
    if (mutation === 'location') {
      f.session!.location = { ...f.session!.location, workspaceId: 'foreign-workspace' }
    }
    if (mutation === 'home') {
      f.session!.accountHome = { ...f.session!.accountHome, path: 'foreign-home' }
    }
    if (mutation === 'provider') {
      f.session!.provider = 'claude'
    }
    if (mutation === 'native') {
      f.record!.commandFingerprint = 'f'.repeat(64)
    }
    if (mutation === 'employee') {
      f.task.agent_id = randomUUID()
    }
    if (mutation === 'input') {
      f.admission.input = 'Different original input'
    }
    if (mutation === 'context') {
      f.admission.workflowContext!.handoffRefs = ['foreign-handoff']
    }
    if (mutation === 'workspaceSelector') {
      f.task.workspace_selector = 'folder:foreign'
    }
    await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.source.readHistory).not.toHaveBeenCalled()
  })
  it.each(['session', 'native', 'service', 'admission', 'case'] as const)(
    'rejects late %s replacement before publishing',
    async (mutation) => {
      const f = workflowCaseSessionFixture()
      vi.mocked(f.source.readHistory).mockImplementation(async () => {
        if (mutation === 'session') {
          f.session!.accountHome = { ...f.session!.accountHome, path: 'changed-private-path' }
        }
        if (mutation === 'native') {
          f.record!.workspace.executionPath = 'changed-private-workspace'
        }
        if (mutation === 'service') {
          f.task.binding!.bindingRef = 'different-original-binding'
        }
        if (mutation === 'admission') {
          f.admission.requestId = randomUUID()
        }
        if (mutation === 'case') {
          f.view = { ...f.view, requirement: 'Changed immutable requirement' }
        }
        return f.history
      })
      await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
    }
  )
  it('allows normal progress and renewable authorization for the same original run', async () => {
    const f = workflowCaseSessionFixture()
    f.settle('running')
    vi.mocked(f.source.readHistory).mockImplementation(async (_id, _page, guard) => {
      f.settle('succeeded')
      f.task.binding!.command = {
        ...f.task.binding!.command,
        authorizationRef: 'renewed-original-authorization',
        expiresAt: '2031-01-01T00:00:00.000Z'
      }
      f.view = { ...f.view, revision: f.view.revision + 1, updatedAt: '2026-10-08T01:00:00.000Z' }
      guard()
      return f.history
    })
    await expect(f.facade().getWorkflowCaseSessionPage(f.query)).resolves.toMatchObject({
      sessionId: f.session!.sessionId
    })
    expect(f.record!.status).toBe('succeeded')
  })
  it.each(['missing', 'unavailable', 'changed', 'capacity'] as const)(
    'maps safe journal %s errors',
    async (code) => {
      const f = workflowCaseSessionFixture()
      vi.mocked(f.source.readHistory).mockRejectedValue(new AgentSessionPassiveJournalError(code))
      await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow(
        {
          missing: 'EXECUTION_NOT_FOUND',
          unavailable: 'SERVICE_UNAVAILABLE',
          changed: 'OUTCOME_UNKNOWN',
          capacity: 'CAPACITY_EXCEEDED'
        }[code]
      )
    }
  )
  it('scrubs raw private reader errors and rejects mismatched results', async () => {
    const f = workflowCaseSessionFixture()
    vi.mocked(f.source.readHistory).mockRejectedValueOnce(new Error('private-home-secret-path'))
    await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow(
      'SERVICE_UNAVAILABLE'
    )
    vi.mocked(f.source.readHistory).mockResolvedValue({
      ...f.history,
      page: { ...f.history.page, sessionId: 'foreign-case-session' }
    })
    await expect(f.facade().getWorkflowCaseSessionPage(f.query)).rejects.toThrow('OUTCOME_UNKNOWN')
  })
  it('strictly refuses unrelated request fields and before without a cursor', async () => {
    const f = workflowCaseSessionFixture()
    for (const query of [
      { ...f.query, sessionId: 'other' },
      { ...f.query, direction: 'after' },
      { ...f.query, direction: 'before' }
    ]) {
      await expect(f.facade().getWorkflowCaseSessionPage(query)).rejects.toThrow('INVALID_REQUEST')
    }
    expect(f.source.readExecution).not.toHaveBeenCalled()
  })
})
