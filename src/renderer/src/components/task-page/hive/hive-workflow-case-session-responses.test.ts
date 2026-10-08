import { describe, expect, it } from 'vitest'
import { readWorkflowCaseSessionPage } from './hive-workflow-case-session-responses'
import {
  workflowSessionPage,
  workflowSessionQuery
} from './hive-workflow-case-session.test-fixtures'

describe('original Case session response admission', () => {
  const query = workflowSessionQuery()
  const page = workflowSessionPage(query)
  it('admits only the resolved original scope and identity', () => {
    expect(readWorkflowCaseSessionPage(page, query, null)).toEqual(page)
    for (const field of ['projectId', 'caseId', 'taskId', 'runId'] as const) {
      expect(() =>
        readWorkflowCaseSessionPage(
          { ...page, [field]: '00000000-0000-4000-8000-000000009999' },
          query,
          null
        )
      ).toThrow('INVALID_RESPONSE')
    }
    expect(() =>
      readWorkflowCaseSessionPage(page, query, { ...page, sessionId: 'replacement-session' })
    ).toThrow('INVALID_RESPONSE')
    expect(() =>
      readWorkflowCaseSessionPage(page, query, { ...page, workspaceId: 'replacement-workspace' })
    ).toThrow('INVALID_RESPONSE')
  })
  it('rejects provider payloads, unsupported hosts and cross-direction responses', () => {
    for (const change of [
      { providerSession: {} },
      { executionHostId: 'remote' },
      { provider: 'claude' }
    ]) {
      expect(() => readWorkflowCaseSessionPage({ ...page, ...change }, query, null)).toThrow(
        'INVALID_RESPONSE'
      )
    }
    expect(() =>
      readWorkflowCaseSessionPage(
        {
          ...page,
          history: { ...page.history, page: { ...page.history.page, direction: 'before' } }
        },
        query,
        null
      )
    ).toThrow('INVALID_RESPONSE')
  })
  it('requires earlier-page progress in the exact requested epoch', () => {
    const before = {
      ...query,
      direction: 'before' as const,
      cursor: { epoch: 'original-epoch', sequence: 41 }
    }
    expect(
      readWorkflowCaseSessionPage(workflowSessionPage(before, [39, 40], true), before, page)
    ).toBeTruthy()
    for (const invalid of [
      workflowSessionPage(before, [41], true),
      workflowSessionPage(before, [39], true, 'replacement-epoch')
    ]) {
      expect(() => readWorkflowCaseSessionPage(invalid, before, page)).toThrow('INVALID_RESPONSE')
    }
    expect(() =>
      readWorkflowCaseSessionPage(workflowSessionPage(before, [], true), before, page)
    ).toThrow('INVALID_RESPONSE')
  })
  it('admits a real tail reset without confusing it with a before success', () => {
    const before = {
      ...query,
      direction: 'before' as const,
      cursor: { epoch: 'old-epoch', sequence: 41 }
    }
    const replacement = workflowSessionPage(query, [2], false, 'new-epoch')
    const reset = {
      ...replacement,
      history: { ...replacement.history, ok: false, reset: 'epoch_changed' }
    }
    expect(readWorkflowCaseSessionPage(reset, before, page).history.ok).toBe(false)
    expect(() =>
      readWorkflowCaseSessionPage({ ...reset, sessionId: 'other-session' }, before, page)
    ).toThrow('INVALID_RESPONSE')
  })
})
