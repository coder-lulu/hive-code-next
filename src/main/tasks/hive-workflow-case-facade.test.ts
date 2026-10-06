import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import { workflowCaseFixture } from '../../shared/hive-workflow-cases.test-fixture'
import { HiveWorkflowCaseViewSchema } from '../../shared/hive-workflow-cases'
import type { HiveWorkflowCaseCreateReply } from '../../shared/hive-workflow-cases'
import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import { createHiveTaskFacade } from './hive-task-facade'
import { TaskArtifactIndex } from './task-artifact-index'

const fixtureRoot = resolve('logs/paperclip-development/p3/cases/facade/tmp')
let directory: string
beforeEach(async () => {
  await mkdir(fixtureRoot, { recursive: true })
  directory = await mkdtemp(join(fixtureRoot, 'case-'))
})
afterEach(async () => {
  if (directory.startsWith(`${fixtureRoot}${sep}`)) {
    await rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const data = workflowCaseFixture()
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'workflow-case-owner',
    authorityId: 'authority:case',
    accessToken: 'fixture-token',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 60_000
  }
  let response: unknown = data.view
  let admission: Partial<HiveWorkflowCaseCreateReply['admission']> = {}
  let page: unknown = { items: [data.summary], nextCursor: null }
  let workspaceCurrent = true
  let onCaseRequest = () => {}
  const calls: { path: string; body: unknown }[] = []
  const issuer = { issue: vi.fn() }
  const descriptorPath = join(directory, 'service.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1', secret: 'fixture-secret' })
  )
  const validateWorkspace = vi.fn(async () => ({
    workspaceRef: data.team.project.binding.hiveWorkspaceRef,
    assertCurrent() {
      if (!workspaceCurrent) {
        throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' })
      }
    }
  }))
  const { facade } = createHiveTaskFacade({
    descriptorPath,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    issuer,
    currentAccount: () => account,
    validateWorkspace,
    assertCurrent() {},
    request: (options) => async (path, body) => {
      expect(options.headers?.['X-Hive-Account-Id']).toBe('workflow-case-owner')
      calls.push({ path, body })
      if (path === '/hive/workbench/team/read') {
        return data.team
      }
      if (path === '/hive/workbench/workflows/read') {
        return data.workflow
      }
      if (path === '/hive/workbench/cases/list') {
        onCaseRequest()
        return page
      }
      if (path === '/hive/workbench/cases/create') {
        onCaseRequest()
        return {
          admission: {
            requestId: data.input.requestId,
            caseId: data.view.id,
            payloadFingerprint: canonicalAgentSessionDigest({
              operation: 'cases.create',
              input: data.input
            }),
            replayed: false,
            ...admission
          },
          view: response
        }
      }
      if (path === '/hive/workbench/cases/read') {
        onCaseRequest()
        return response
      }
      throw new Error('Unexpected task-service path')
    }
  })
  return {
    ...data,
    facade,
    issuer,
    calls,
    validateWorkspace,
    response(value: unknown) {
      response = value
    },
    admission(value: Partial<HiveWorkflowCaseCreateReply['admission']>) {
      admission = value
    },
    page(value: unknown) {
      page = value
    },
    setAccount(value: HiveRuntimeCloudAuthorization | null) {
      account = value
    },
    onRequest(value: () => void) {
      onCaseRequest = value
    },
    replaceWorkspace() {
      workspaceCurrent = false
    },
    query: { projectId: data.input.projectId, caseId: data.view.id }
  }
}

describe('authenticated workflow case Facade through the shared service context', () => {
  it.each(['read', 'list', 'create'] as const)(
    'accepts case-equivalent UUID input when it performs %s',
    async (operation) => {
      const f = await fixture()
      const result =
        operation === 'read'
          ? await f.facade.getWorkflowCase({
              projectId: f.query.projectId.toUpperCase(),
              caseId: f.query.caseId.toUpperCase()
            })
          : operation === 'list'
            ? await f.facade.listWorkflowCases({
                projectId: f.input.projectId.toUpperCase(),
                workflowId: f.input.workflowId.toUpperCase()
              })
            : await f.facade.createWorkflowCase({
                ...f.input,
                requestId: f.input.requestId.toUpperCase(),
                projectId: f.input.projectId.toUpperCase(),
                workflowId: f.input.workflowId.toUpperCase()
              })
      expect(result).toEqual(
        operation === 'list' ? { items: [f.summary], nextCursor: null } : f.view
      )
      expect(f.calls.at(-1)?.body).toMatchObject({ projectId: f.input.projectId })
      if (operation === 'create') {
        expect(f.calls.at(-1)?.body).toEqual(f.input)
      }
    }
  )
  it.each(
    (['read', 'replay'] as const).flatMap((operation) =>
      (['account', 'actor', 'tenant', 'scope'] as const).map((field) => ({ operation, field }))
    )
  )('rejects a foreign historical $field owner during $operation', async ({ operation, field }) => {
    const f = await fixture()
    const foreign = structuredClone(f.view)
    const binding = foreign.team.company
    if (field === 'account') {
      binding.ownerAccountRef = 'account:foreign'
    } else if (field === 'actor') {
      binding.ownerActorRef = 'actor:foreign'
    } else if (field === 'tenant') {
      binding.ownerScope = { kind: 'personalTenant', tenantRef: 'account:foreign' }
    } else {
      binding.ownerScope = { kind: 'teamSpace', teamSpaceRef: 'team:foreign' }
    }
    expect(HiveWorkflowCaseViewSchema.safeParse(foreign).success).toBe(true)
    f.response(foreign)
    if (operation === 'replay') {
      f.admission({ replayed: true })
      f.team.project.binding.bindingRevision += 1
      f.team.employees.forEach((employee) => {
        employee.binding.bindingRevision += 1
      })
    }
    await expect(
      operation === 'read'
        ? f.facade.getWorkflowCase(f.query)
        : f.facade.createWorkflowCase(f.input)
    ).rejects.toThrow('FORBIDDEN')
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })
  it.each(['duplicate', 'cursor'] as const)(
    'rejects UUID case aliases that bypass the %s pagination boundary',
    async (boundary) => {
      const f = await fixture()
      const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
      const lower = { ...f.summary, id, binding: { ...f.summary.binding, workflowRunRef: id } }
      const upper = {
        ...lower,
        id: id.toUpperCase(),
        binding: { ...lower.binding, workflowRunRef: id.toUpperCase() }
      }
      f.page({ items: boundary === 'duplicate' ? [upper, lower] : [lower], nextCursor: null })
      await expect(
        f.facade.listWorkflowCases({
          projectId: f.input.projectId,
          ...(boundary === 'cursor' ? { after: id.toUpperCase() } : {})
        })
      ).rejects.toThrow('REVISION_CONFLICT')
    }
  )
  it('saves the fixed requirement without issuing a Runtime binding or dispatching', async () => {
    const f = await fixture()
    expect(await f.facade.createWorkflowCase(f.input)).toEqual(f.view)
    expect(f.validateWorkspace).toHaveBeenCalledWith(f.team.project.workspaceSelector)
    expect(f.calls.filter((call) => call.path.endsWith('/cases/create'))).toEqual([
      { path: '/hive/workbench/cases/create', body: f.input }
    ])
    expect(f.issuer.issue).not.toHaveBeenCalled()
    expect(f.calls.some((call) => call.path.includes('dispatch'))).toBe(false)
  })

  it('rejects an unconfigured team and a different workspace before admission', async () => {
    const missing = await fixture()
    missing.team.employees = []
    missing.team.executionAvailability.reason = 'TEAM_NOT_CONFIGURED'
    await expect(missing.facade.createWorkflowCase(missing.input)).rejects.toThrow(
      'CAPABILITY_UNAVAILABLE'
    )
    expect(missing.calls.some((call) => call.path.endsWith('/cases/create'))).toBe(false)
    const changed = await fixture()
    changed.validateWorkspace.mockResolvedValue({
      workspaceRef: 'workspace:another',
      assertCurrent() {}
    })
    await expect(changed.facade.createWorkflowCase(changed.input)).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(changed.calls.some((call) => call.path.endsWith('/cases/create'))).toBe(false)
  })

  it('rejects a changed definition digest before writing a requirement', async () => {
    const f = await fixture()
    await expect(
      f.facade.createWorkflowCase({ ...f.input, definitionDigest: 'a'.repeat(64) })
    ).rejects.toThrow('REVISION_CONFLICT')
    expect(f.calls.some((call) => call.path.endsWith('/cases/create'))).toBe(false)
  })

  it.each(['title', 'requirement'] as const)(
    'rejects a create response with changed %s',
    async (field) => {
      const f = await fixture()
      f.response({ ...f.view, [field]: 'A different requested result' })
      await expect(f.facade.createWorkflowCase(f.input)).rejects.toThrow('REVISION_CONFLICT')
    }
  )

  it.each(['title', 'requirement'] as const)(
    'recovers the original request after the real business %s changes',
    async (field) => {
      const f = await fixture()
      const current = { ...f.view, [field]: 'Updated current business value', revision: 2 }
      f.response(current)
      f.admission({ replayed: true })
      f.team.project.binding.bindingRevision += 1
      f.team.employees.forEach((employee) => {
        employee.binding.bindingRevision += 1
      })
      expect(await f.facade.createWorkflowCase(f.input)).toEqual(current)
      expect(f.issuer.issue).not.toHaveBeenCalled()
    }
  )

  it.each(['requestId', 'caseId', 'payloadFingerprint'] as const)(
    'rejects a recovered admission acknowledgement with a swapped %s',
    async (field) => {
      const f = await fixture()
      f.admission({
        replayed: true,
        [field]: field === 'payloadFingerprint' ? 'f'.repeat(64) : randomUUID()
      })
      await expect(f.facade.createWorkflowCase(f.input)).rejects.toThrow()
      expect(f.issuer.issue).not.toHaveBeenCalled()
    }
  )

  it('reads a pinned old case after current team and definition revisions change', async () => {
    const f = await fixture()
    f.team.project.binding.bindingRevision += 1
    f.team.employees.forEach((employee) => {
      employee.binding.bindingRevision += 1
    })
    expect(await f.facade.getWorkflowCase(f.query)).toEqual(f.view)
    expect(f.calls.some((call) => call.path.endsWith('/workflows/read'))).toBe(false)
  })

  it('permits the service to recover an existing request after a later team revision', async () => {
    const f = await fixture()
    f.admission({ replayed: true })
    f.team.project.binding.bindingRevision += 1
    f.team.employees.forEach((employee) => {
      employee.binding.bindingRevision += 1
    })
    expect(await f.facade.createWorkflowCase(f.input)).toEqual(f.view)
    expect(f.calls.filter((call) => call.path.endsWith('/cases/create'))).toHaveLength(1)
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })

  it('rejects swapped case IDs and foreign project summaries', async () => {
    const f = await fixture()
    await expect(f.facade.getWorkflowCase({ ...f.query, caseId: randomUUID() })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    f.page({
      items: [
        {
          ...f.summary,
          binding: {
            ...f.summary.binding,
            scope: {
              ...f.summary.binding.scope,
              projectRef: randomUUID()
            }
          }
        }
      ],
      nextCursor: null
    })
    await expect(f.facade.listWorkflowCases({ projectId: f.input.projectId })).rejects.toThrow(
      'REVISION_CONFLICT'
    )
  })

  it('rejects repeated, out-of-order and nonadvancing page cursors', async () => {
    const f = await fixture()
    for (const page of [
      { items: [f.summary, f.summary], nextCursor: null },
      { items: [f.summary], nextCursor: randomUUID() },
      { items: [], nextCursor: f.view.id }
    ]) {
      f.page(page)
      await expect(f.facade.listWorkflowCases({ projectId: f.input.projectId })).rejects.toThrow(
        'REVISION_CONFLICT'
      )
    }
    f.page({ items: [f.summary], nextCursor: null })
    await expect(
      f.facade.listWorkflowCases({ projectId: f.input.projectId, after: f.view.id })
    ).rejects.toThrow('REVISION_CONFLICT')
  })

  it('refuses responses from another workflow and honors caller page limits', async () => {
    const f = await fixture()
    await expect(
      f.facade.listWorkflowCases({ projectId: f.input.projectId, workflowId: randomUUID() })
    ).rejects.toThrow('REVISION_CONFLICT')
    const later = workflowCaseFixture().summary
    later.binding.scope = f.summary.binding.scope
    f.page({
      items: [f.summary, later].toSorted((a, b) => a.id.localeCompare(b.id)),
      nextCursor: null
    })
    await expect(
      f.facade.listWorkflowCases({ projectId: f.input.projectId, limit: 1 })
    ).rejects.toThrow('REVISION_CONFLICT')
  })

  it.each(['read', 'list', 'create'] as const)(
    'rejects account revocation while %s is in flight',
    async (operation) => {
      const f = await fixture()
      f.onRequest(() => f.setAccount(null))
      const action =
        operation === 'read'
          ? f.facade.getWorkflowCase(f.query)
          : operation === 'list'
            ? f.facade.listWorkflowCases({ projectId: f.input.projectId })
            : f.facade.createWorkflowCase(f.input)
      await expect(action).rejects.toThrow('FORBIDDEN')
      expect(f.issuer.issue).not.toHaveBeenCalled()
    }
  )

  it('rechecks the actual source workspace after the save response', async () => {
    const f = await fixture()
    f.onRequest(() => f.replaceWorkspace())
    await expect(f.facade.createWorkflowCase(f.input)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.issuer.issue).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated calls before any business request', async () => {
    const f = await fixture()
    f.setAccount(null)
    await expect(f.facade.createWorkflowCase(f.input)).rejects.toThrow('FORBIDDEN')
    expect(f.calls).toHaveLength(0)
  })
})
