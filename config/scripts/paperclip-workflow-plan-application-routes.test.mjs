import { randomUUID } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import {
  handleTeamWorkbenchRequest,
  WORKBENCH_PATHS
} from '../../integration/paperclip/service/team-workbench-routes.mjs'

describe('plan application service routes', () => {
  const query = { projectId: randomUUID(), caseId: randomUUID(), draftRef: 'plan-draft:original' }
  const input = {
    ...query,
    requestId: randomUUID(),
    expectedCaseRevision: 1,
    expectedProjectRevision: 2,
    planRevision: 1,
    draftDigest: 'a'.repeat(64)
  }
  it.each([
    ['/hive/workbench/plans/read', 'getWorkflowPlanApplication', query],
    ['/hive/workbench/plans/apply', 'applyWorkflowPlan', input]
  ])('uses authenticated account and strict schema for %s', (path, method, body) => {
    const repository = { [method]: vi.fn(() => 'response') }
    expect(WORKBENCH_PATHS).toContain(path)
    expect(handleTeamWorkbenchRequest(repository, 'trusted-account', path, body)).toBe('response')
    expect(repository[method]).toHaveBeenCalledWith('trusted-account', body)
    expect(() =>
      handleTeamWorkbenchRequest(repository, 'trusted-account', path, {
        ...body,
        accountId: 'forged',
        command: 'execute'
      })
    ).toThrow()
    expect(repository[method]).toHaveBeenCalledTimes(1)
  })
})
