import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  handleTeamWorkbenchRequest,
  WORKBENCH_PATHS
} from '../../integration/paperclip/service/team-workbench-routes.mjs'

const companyId = randomUUID()
const projectId = randomUUID()
const employees = ['product', 'developer', 'tester', 'ops'].map((role) => ({
  role,
  name: role,
  profileRef: 'codex',
  profileRevision: 'codex:1'
}))
const projectInput = {
  requestId: randomUUID(),
  companyId,
  name: 'Project',
  workspaceSelector: 'folder:project',
  hiveWorkspaceRef: 'workspace:host-validated'
}
const teamInput = { requestId: randomUUID(), projectId, expectedRevision: 1, employees }
const fixture = () =>
  Object.fromEntries(
    [
      'listCompanies',
      'createCompany',
      'listProjects',
      'createProject',
      'getTeam',
      'configureTeam'
    ].map((method) => [method, vi.fn(() => ({ called: method }))])
  )

describe('restricted team workbench request routing', () => {
  it.each([
    ['/hive/workbench/companies/list', 'listCompanies', {}, { limit: 25 }],
    [
      '/hive/workbench/companies/create',
      'createCompany',
      { requestId: companyId, name: '  Team  ' },
      { requestId: companyId, name: 'Team' }
    ],
    ['/hive/workbench/projects/list', 'listProjects', { companyId }, { companyId, limit: 25 }],
    ['/hive/workbench/projects/create', 'createProject', projectInput, projectInput],
    ['/hive/workbench/team/read', 'getTeam', { projectId }, projectId],
    ['/hive/workbench/team/configure', 'configureTeam', teamInput, teamInput]
  ])('parses %s and uses the authenticated account', (path, method, body, parsed) => {
    const repository = fixture()
    expect(WORKBENCH_PATHS).toContain(path)
    expect(handleTeamWorkbenchRequest(repository, 'authenticated-account', path, body)).toEqual({
      called: method
    })
    expect(repository[method]).toHaveBeenCalledWith('authenticated-account', parsed)
    expect(
      Object.values(repository).filter((handler) => handler.mock.calls.length > 0)
    ).toHaveLength(1)
  })

  it.each([
    '/hive/workbench/team/dispatch',
    '/hive/workbench/team/configure?dispatch=true',
    '/api/agents',
    '/api/companies/test/skills',
    '/hive/workbench/companies/delete'
  ])('denies the unsupported endpoint %s before repository access', (path) => {
    const repository = fixture()
    expect(() => handleTeamWorkbenchRequest(repository, 'account', path, teamInput)).toThrow(
      'FORBIDDEN'
    )
    expect(Object.values(repository).every((handler) => handler.mock.calls.length === 0)).toBe(true)
  })

  it.each(['command', 'env', 'provider', 'credentials', 'tenant', 'accountId', 'executionPolicy'])(
    'rejects caller-supplied %s before persistence',
    (field) => {
      const repository = fixture()
      expect(() =>
        handleTeamWorkbenchRequest(repository, 'account', '/hive/workbench/team/configure', {
          ...teamInput,
          [field]: 'untrusted'
        })
      ).toThrow()
      expect(repository.configureTeam).not.toHaveBeenCalled()
    }
  )

  it.each([
    { ...teamInput, employees: employees.slice(0, 3) },
    { ...teamInput, employees: [...employees, employees[0]] },
    { ...teamInput, employees: [employees[0], employees[0], employees[2], employees[3]] },
    {
      ...teamInput,
      employees: [{ ...employees[0], profileRef: 'native-pi' }, ...employees.slice(1)]
    },
    {
      ...teamInput,
      employees: [{ ...employees[0], profileRevision: 'codex:2' }, ...employees.slice(1)]
    },
    {
      ...teamInput,
      employees: [{ ...employees[0], env: { SECRET: 'must-not-persist' } }, ...employees.slice(1)]
    },
    { ...teamInput, expectedRevision: 0 }
  ])('rejects an incomplete, conflicting or uncontrolled employee configuration', (body) => {
    const repository = fixture()
    expect(() =>
      handleTeamWorkbenchRequest(repository, 'account', '/hive/workbench/team/configure', body)
    ).toThrow()
    expect(repository.configureTeam).not.toHaveBeenCalled()
  })

  it.each([
    { requestId: randomUUID(), companyId, name: 'Project', workspaceSelector: 'folder:project' },
    { ...projectInput, hiveWorkspaceRef: '' },
    { ...projectInput, hiveWorkspaceRef: 'x'.repeat(161) },
    { ...projectInput, ownerActorRef: 'actor:forged' }
  ])('requires the validated internal project binding and rejects extra fields', (body) => {
    const repository = fixture()
    expect(() =>
      handleTeamWorkbenchRequest(repository, 'account', '/hive/workbench/projects/create', body)
    ).toThrow()
    expect(repository.createProject).not.toHaveBeenCalled()
  })

  it.each([{ limit: 51 }, { limit: 0 }, { after: 'not-a-uuid' }, { limit: '25' }])(
    'rejects an invalid or excessive page before access',
    (body) => {
      const repository = fixture()
      expect(() =>
        handleTeamWorkbenchRequest(repository, 'account', '/hive/workbench/companies/list', body)
      ).toThrow()
      expect(repository.listCompanies).not.toHaveBeenCalled()
    }
  )

  it('rejects extra team-read fields instead of treating them as execution controls', () => {
    const repository = fixture()
    expect(() =>
      handleTeamWorkbenchRequest(repository, 'account', '/hive/workbench/team/read', {
        projectId,
        dispatch: true
      })
    ).toThrow()
    expect(repository.getTeam).not.toHaveBeenCalled()
  })
})
