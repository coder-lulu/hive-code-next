import { createHash, randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiveRuntimeCloudAuthorization } from '../hive-account/hive-account-publication'
import type { HiveWorkbenchTeam } from '../../shared/hive-team-workbench'
import { createHiveTaskFacade } from './hive-task-facade'
import { TaskArtifactIndex } from './task-artifact-index'
import { taskTestDirectory } from './task-execution.test-fixture'

let directory: string
beforeEach(async () => {
  directory = await taskTestDirectory()
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function fixture(companyId = randomUUID(), projectId = randomUUID()) {
  let account: HiveRuntimeCloudAuthorization | null = {
    accountId: 'workbench-owner',
    authorityId: 'authority:workbench',
    accessToken: 'test-token',
    sessionGeneration: 1,
    sessionExpiresAt: Date.now() + 60_000
  }
  const digest = createHash('sha256').update(JSON.stringify(account.accountId)).digest('hex')
  const team: HiveWorkbenchTeam = {
    company: {
      id: companyId,
      name: 'My company',
      binding: {
        contractVersion: 1,
        kind: 'workflow.company-binding',
        companyRef: companyId,
        ownerScope: { kind: 'personalTenant', tenantRef: `account:${digest}` },
        ownerAccountRef: `account:${digest}`,
        ownerActorRef: `actor:${digest}`,
        bindingRevision: 1
      }
    },
    project: {
      id: projectId,
      companyId,
      name: 'My project',
      workspaceSelector: 'folder:source',
      binding: {
        contractVersion: 1,
        kind: 'workflow.project-binding',
        scope: { companyRef: companyId, projectRef: projectId },
        hiveWorkspaceRef: 'workspace:verified',
        bindingRevision: 2
      }
    },
    employees: (['product', 'developer', 'tester', 'ops'] as const).map((role) => ({
      name: role,
      binding: {
        contractVersion: 1,
        kind: 'workflow.employee-binding',
        scope: { companyRef: companyId, projectRef: projectId },
        employeeRef: randomUUID(),
        role,
        adapterType: 'hive_runtime',
        executor: 'codex',
        profileRef: 'codex',
        profileRevision: 'codex:1',
        bindingRevision: 2
      }
    })),
    executionAvailability: { available: false, reason: 'EXECUTION_ISOLATION_UNAVAILABLE' }
  }
  const projectInput = {
    requestId: randomUUID(),
    companyId,
    name: team.project.name,
    workspaceSelector: team.project.workspaceSelector
  }
  const configureInput = {
    requestId: randomUUID(),
    projectId,
    expectedRevision: 1,
    employees: team.employees.map(({ name, binding }) => ({
      name,
      role: binding.role,
      profileRef: 'codex' as const,
      profileRevision: 'codex:1' as const
    }))
  }
  const request = vi.fn(async (path: string, _body?: unknown): Promise<unknown> => {
    if (path === '/hive/workbench/companies/list') {
      return { items: [team.company], nextCursor: null }
    }
    if (path === '/hive/workbench/companies/create') {
      return team.company
    }
    if (path === '/hive/workbench/projects/list') {
      return { items: [team.project], nextCursor: null }
    }
    if (path === '/hive/workbench/projects/create') {
      return team.project
    }
    return team
  })
  const validateWorkspace = vi.fn(async (_selector: string) => ({
    workspaceRef: 'workspace:verified',
    assertCurrent: () => undefined
  }))
  const descriptorPath = join(directory, 'paperclip.json')
  await writeFile(
    descriptorPath,
    JSON.stringify({ baseUrl: 'http://127.0.0.1:1234', secret: 'x'.repeat(43) })
  )
  const { facade } = createHiveTaskFacade({
    descriptorPath,
    artifacts: new TaskArtifactIndex(join(directory, 'artifacts')),
    issuer: { issue: vi.fn() },
    currentAccount: () => account,
    assertCurrent: () => undefined,
    validateWorkspace,
    request: () => request
  })
  return {
    facade,
    request,
    validateWorkspace,
    team,
    projectInput,
    configureInput,
    signOut: () => {
      account = null
    },
    changeSession: () => {
      if (account) {
        account = { ...account, sessionGeneration: 2 }
      }
    }
  }
}

describe('authenticated team workbench facade', () => {
  it.each(['listProjects', 'createProject', 'getTeam', 'configureTeam'] as const)(
    'accepts case-equivalent UUID input for %s and sends canonical request identities',
    async (operation) => {
      const f = await fixture(
        'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
        'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
      )
      const requestId = 'cccccccc-3333-4333-8333-cccccccccccc'
      const operations = {
        listProjects: () => f.facade.listProjects({ companyId: f.team.company.id.toUpperCase() }),
        createProject: () =>
          f.facade.createProject({
            ...f.projectInput,
            requestId: requestId.toUpperCase(),
            companyId: f.team.company.id.toUpperCase()
          }),
        getTeam: () => f.facade.getTeam(f.team.project.id.toUpperCase()),
        configureTeam: () =>
          f.facade.configureTeam({
            ...f.configureInput,
            requestId: requestId.toUpperCase(),
            projectId: f.team.project.id.toUpperCase()
          })
      }
      const result = await operations[operation]()
      expect(result).toEqual(
        operation === 'listProjects'
          ? { items: [f.team.project], nextCursor: null }
          : operation === 'createProject'
            ? f.team.project
            : f.team
      )
      const body = f.request.mock.calls.at(-1)?.[1]
      expect(body).toMatchObject(
        operation === 'listProjects' || operation === 'createProject'
          ? { companyId: f.team.company.id }
          : { projectId: f.team.project.id }
      )
      if (operation === 'createProject' || operation === 'configureTeam') {
        expect(body).toMatchObject({ requestId })
      }
    }
  )
  it('routes all six operations through the scoped service and adds only the host workspace reference', async () => {
    const f = await fixture()
    await f.facade.listCompanies({ limit: 10 })
    await f.facade.createCompany({ requestId: randomUUID(), name: ' My company ' })
    await f.facade.listProjects({ companyId: f.team.company.id, limit: 10 })
    await f.facade.createProject(f.projectInput)
    await f.facade.getTeam(f.team.project.id)
    expect(await f.facade.configureTeam(f.configureInput)).toEqual(f.team)
    expect(f.request.mock.calls.map(([path]) => path)).toEqual([
      '/hive/workbench/companies/list',
      '/hive/workbench/companies/create',
      '/hive/workbench/projects/list',
      '/hive/workbench/projects/create',
      '/hive/workbench/team/read',
      '/hive/workbench/team/configure'
    ])
    expect(f.request).toHaveBeenCalledWith('/hive/workbench/projects/create', {
      ...f.projectInput,
      hiveWorkspaceRef: 'workspace:verified'
    })
    expect(f.validateWorkspace).toHaveBeenCalledWith('folder:source')
  })

  it('refuses signed-out work before reading or creating business objects', async () => {
    const f = await fixture()
    f.signOut()
    await expect(f.facade.listCompanies()).rejects.toThrow('FORBIDDEN')
    await expect(f.facade.createProject(f.projectInput)).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
    expect(f.validateWorkspace).not.toHaveBeenCalled()
  })

  it('rejects session changes while workspace authorization is pending before a project write', async () => {
    const f = await fixture()
    f.validateWorkspace.mockImplementation(async () => {
      f.changeSession()
      return { workspaceRef: 'workspace:verified', assertCurrent: () => undefined }
    })
    await expect(f.facade.createProject(f.projectInput)).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
  })

  it('rejects an account change during a read before returning its response', async () => {
    const f = await fixture()
    f.request.mockImplementation(async () => {
      f.signOut()
      return { items: [f.team.company], nextCursor: null }
    })
    await expect(f.facade.listCompanies()).rejects.toThrow('FORBIDDEN')
  })

  it('refuses unknown or remote workspaces before persisting a project', async () => {
    const f = await fixture()
    f.validateWorkspace.mockRejectedValue(new Error('FORBIDDEN'))
    await expect(f.facade.createProject(f.projectInput)).rejects.toThrow('FORBIDDEN')
    expect(f.request).not.toHaveBeenCalled()
  })

  it('rejects injected workspace references and execution configuration before any request', async () => {
    const f = await fixture()
    const forgedReference = { ...f.projectInput, hiveWorkspaceRef: 'workspace:forged' }
    const forgedCommand = { ...f.projectInput, command: 'run anything' }
    await expect(f.facade.createProject(forgedReference)).rejects.toThrow()
    await expect(f.facade.createProject(forgedCommand)).rejects.toThrow()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.validateWorkspace).not.toHaveBeenCalled()
  })

  it('rejects foreign-owner company projections', async () => {
    const f = await fixture()
    f.team.company.binding.ownerAccountRef = 'account:someone-else'
    await expect(f.facade.listCompanies()).rejects.toThrow('FORBIDDEN')
  })

  it('rejects a substituted workspace in a successful backend reply', async () => {
    const f = await fixture()
    f.team.project.binding.hiveWorkspaceRef = 'workspace:elsewhere'
    await expect(f.facade.createProject(f.projectInput)).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects a team returned for another project', async () => {
    const f = await fixture()
    await expect(f.facade.getTeam(randomUUID())).rejects.toThrow('REVISION_CONFLICT')
  })

  it('rejects stale configure receipts and preserves the unavailable execution state', async () => {
    const f = await fixture()
    f.team.project.binding.bindingRevision = 3
    await expect(f.facade.configureTeam(f.configureInput)).rejects.toThrow('REVISION_CONFLICT')
    f.team.project.binding.bindingRevision = 2
    expect((await f.facade.configureTeam(f.configureInput)).executionAvailability.available).toBe(
      false
    )
  })
})
