import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { canonicalAgentSessionDigest } from '../../src/shared/agent-session-mutation-envelope.ts'

const accountId = 'authenticated:hive-account'
const companyId = randomUUID()
const projectId = randomUUID()
const accountRef = `account:${canonicalAgentSessionDigest(accountId)}`
const actorRef = `actor:${canonicalAgentSessionDigest(accountId)}`
const employees = ['product', 'developer', 'tester', 'ops'].map((role) => ({
  role,
  name: `AI ${role}`,
  profileRef: 'codex',
  profileRevision: 'codex:1'
}))
const employeeIds = Object.fromEntries(employees.map((employee) => [employee.role, randomUUID()]))
const companyRow = (id = companyId) => ({
  company_id: id,
  company_name: 'Hive team',
  company_revision: 1,
  owner_account_ref: accountRef,
  owner_actor_ref: actorRef,
  tenant_ref: accountRef
})
const projectRow = (revision = 1, id = projectId) => ({
  ...companyRow(),
  project_id: id,
  project_name: 'Project',
  workspace_selector: 'folder:project',
  hive_workspace_ref: 'workspace:host-validated',
  project_revision: revision
})
const employeeRows = (revision = 2) =>
  employees.map((employee) => ({
    employee_id: employeeIds[employee.role],
    name: employee.name,
    adapter_type: 'hive_runtime',
    upstream_role: { product: 'pm', developer: 'engineer', tester: 'qa', ops: 'devops' }[
      employee.role
    ],
    adapter_config: {},
    company_id: companyId,
    project_id: projectId,
    role: employee.role,
    profile_ref: employee.profileRef,
    profile_revision: employee.profileRevision,
    binding_revision: revision
  }))
const companyDto = () => ({
  id: companyId,
  name: 'Hive team',
  binding: {
    contractVersion: 1,
    kind: 'workflow.company-binding',
    companyRef: companyId,
    ownerScope: { kind: 'personalTenant', tenantRef: accountRef },
    ownerAccountRef: accountRef,
    ownerActorRef: actorRef,
    bindingRevision: 1
  }
})
const teamInput = (revision = 1) => ({
  requestId: randomUUID(),
  projectId,
  expectedRevision: revision,
  employees
})
const receipt = (operation, input, response) => ({
  operation,
  payload_fingerprint: canonicalAgentSessionDigest({ operation, input }),
  company_id: companyId,
  response_json: response
})

/** Script only database replies; authorization, receipts and transaction order execute in the repository. */
function sqlFixture(replies = []) {
  const calls = []
  const db = vi.fn(async (strings, ...values) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim()
    calls.push({ text, values })
    if (replies.length === 0) {
      throw new Error(`Unexpected SQL: ${text}`)
    }
    const answer = replies.shift()
    return typeof answer === 'function' ? answer({ text, values }) : answer
  })
  db.json = (value) => value
  db.begin = vi.fn((run) => run(db))
  const writes = () => calls.filter((call) => /^(INSERT|UPDATE|DELETE)/.test(call.text))
  return { sql: db, calls, writes, repository: createTeamWorkbenchRepository(db) }
}

describe('Paperclip team workbench ownership and immutable replay', () => {
  it('creates the upstream company and canonical owned binding in one transaction', async () => {
    const input = { requestId: randomUUID(), name: 'Hive team' }
    const f = sqlFixture([[], [], [], [], ({ values }) => [companyRow(values[0])], []])
    const result = await f.repository.createCompany(accountId, input)
    expect(result.binding.ownerScope).toEqual({ kind: 'personalTenant', tenantRef: accountRef })
    expect(result.binding.ownerAccountRef).toBe(accountRef)
    expect(result.binding.ownerActorRef).toBe(actorRef)
    expect(result.id).toBe(result.binding.companyRef)
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.writes().map((query) => query.text.match(/^INSERT INTO (\w+)/)[1])).toEqual([
      'companies',
      'hive_workbench_company_bindings',
      'hive_workbench_request_receipts'
    ])
    expect(f.writes()[0].values).toEqual([
      result.id,
      'Hive team',
      expect.stringMatching(/^HIVE[a-f0-9]{16}$/)
    ])
    expect(f.writes().at(-1).values.at(-1)).toEqual(result)
  })

  it('returns the original successful receipt despite newer names without repeating writes', async () => {
    const input = { requestId: randomUUID(), name: 'Hive team' }
    const original = companyDto()
    const f = sqlFixture([
      [],
      [receipt('companies.create', input, original)],
      [{ ...companyRow(), company_name: 'Renamed' }]
    ])
    expect(await f.repository.createCompany(accountId, input)).toEqual(original)
    expect(f.writes()).toHaveLength(0)
    expect(f.calls[2].values).toEqual([companyId, accountId])
  })

  it.each(['companies.create', 'projects.create', 'team.configure'])(
    'rejects a request key reused under %s or changed input',
    async (operation) => {
      const original = { requestId: randomUUID(), name: 'Hive team' }
      const input = {
        ...original,
        name: operation === 'companies.create' ? 'Different' : 'Hive team'
      }
      const f = sqlFixture([[], [receipt(operation, original, companyDto())], [companyRow()]])
      await expect(f.repository.createCompany(accountId, input)).rejects.toThrow(
        'IDEMPOTENCY_CONFLICT'
      )
      expect(f.writes()).toHaveLength(0)
    }
  )

  it('requires current ownership before replaying an old successful request', async () => {
    const input = { requestId: randomUUID(), name: 'Hive team' }
    const f = sqlFixture([[], [receipt('companies.create', input, companyDto())], []])
    await expect(f.repository.createCompany(accountId, input)).rejects.toThrow('FORBIDDEN')
    expect(f.writes()).toHaveLength(0)
  })

  it('refuses a persisted receipt whose response was moved outside its authorized company', async () => {
    const input = { requestId: randomUUID(), name: 'Hive team' }
    const original = companyDto()
    const foreignId = randomUUID()
    const changed = {
      ...original,
      id: foreignId,
      binding: { ...original.binding, companyRef: foreignId }
    }
    const f = sqlFixture([[], [receipt('companies.create', input, changed)], [companyRow()]])
    await expect(f.repository.createCompany(accountId, input)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it.each(['owner_account_ref', 'owner_actor_ref', 'tenant_ref'])(
    'rejects a mismatched stored %s mapping instead of treating the company name as authority',
    async (field) => {
      const f = sqlFixture([[{ ...companyRow(), [field]: 'scope:another-owner' }]])
      await expect(f.repository.listCompanies(accountId, {})).rejects.toThrow('FORBIDDEN')
      expect(f.writes()).toHaveLength(0)
    }
  )

  it.each(['', null, 'x'.repeat(513)])(
    'denies malformed host identity before SQL',
    async (identity) => {
      const f = sqlFixture()
      await expect(
        f.repository.createCompany(identity, { requestId: randomUUID(), name: 'Team' })
      ).rejects.toThrow('FORBIDDEN')
      expect(f.sql.begin).not.toHaveBeenCalled()
      expect(f.calls).toHaveLength(0)
    }
  )
})

describe('owned project persistence and bounded navigation', () => {
  it('persists the actual project and host-validated workspace reference without execution configuration', async () => {
    const input = {
      requestId: randomUUID(),
      companyId,
      name: 'Project',
      workspaceSelector: 'folder:project',
      hiveWorkspaceRef: 'workspace:host-validated'
    }
    const f = sqlFixture([
      [],
      [],
      [companyRow()],
      [],
      [],
      ({ values }) => [projectRow(1, values[0])],
      []
    ])
    const result = await f.repository.createProject(accountId, input)
    expect(result.companyId).toBe(companyId)
    expect(result.binding.hiveWorkspaceRef).toBe(input.hiveWorkspaceRef)
    expect(result.binding.bindingRevision).toBe(1)
    expect(f.writes().map((query) => query.text.match(/^INSERT INTO (\w+)/)[1])).toEqual([
      'projects',
      'hive_workbench_project_bindings',
      'hive_workbench_request_receipts'
    ])
    expect(f.calls[2].values).toEqual([companyId, accountId])
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
  })

  it('refuses a foreign company before project creation', async () => {
    const f = sqlFixture([[], [], []])
    await expect(
      f.repository.createProject(accountId, {
        requestId: randomUUID(),
        companyId,
        name: 'Project',
        workspaceSelector: 'folder:project',
        hiveWorkspaceRef: 'workspace:host-validated'
      })
    ).rejects.toThrow('FORBIDDEN')
    expect(f.writes()).toHaveLength(0)
  })

  it('does not trust a client project creation body without an internal workspace binding', async () => {
    const f = sqlFixture()
    await expect(
      f.repository.createProject(accountId, {
        requestId: randomUUID(),
        companyId,
        name: 'Project',
        workspaceSelector: 'folder:project'
      })
    ).rejects.toThrow()
    expect(f.sql.begin).not.toHaveBeenCalled()
  })

  it('uses UUID keyset pagination and returns only the requested company page', async () => {
    const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
    const after = '00000000-0000-4000-8000-000000000000'
    const f = sqlFixture([ids.map((id) => companyRow(id))])
    const page = await f.repository.listCompanies(accountId, { after, limit: 2 })
    expect(page.items.map((item) => item.id)).toEqual(ids.slice(0, 2))
    expect(page.nextCursor).toBe(ids[1])
    expect(f.calls[0].values).toEqual([accountId, after, after, 3])
    expect(f.calls[0].text).toContain('c.id>?::uuid')
    expect(f.calls[0].text).toContain('ORDER BY c.id ASC')
  })

  it('holds company ownership through the project-page transaction', async () => {
    const f = sqlFixture([[companyRow()], [projectRow()]])
    const page = await f.repository.listProjects(accountId, { companyId, limit: 50 })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBeNull()
    expect(f.calls[0].text).toContain('FOR SHARE OF c,b')
    expect(f.calls[1].values).toEqual([companyId, null, null, 51])
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
  })

  it('refuses a foreign company page without leaking its projects', async () => {
    const f = sqlFixture([[]])
    await expect(f.repository.listProjects('foreign-account', { companyId })).rejects.toThrow(
      'FORBIDDEN'
    )
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].values).toEqual([companyId, 'foreign-account'])
  })

  it('represents an empty page without a fabricated cursor', async () => {
    const f = sqlFixture([[]])
    expect(await f.repository.listCompanies(accountId, { limit: 50 })).toEqual({
      items: [],
      nextCursor: null
    })
  })

  it('does not accept excessive pagination through direct repository access', async () => {
    const f = sqlFixture()
    await expect(f.repository.listCompanies(accountId, { limit: 51 })).rejects.toThrow()
    expect(f.sql.begin).not.toHaveBeenCalled()
  })
})

describe('four-role team configuration and execution availability', () => {
  it('reports an unconfigured owned project as unavailable', async () => {
    const f = sqlFixture([[projectRow()], []])
    const result = await f.repository.getTeam(accountId, projectId)
    expect(result.employees).toEqual([])
    expect(result.executionAvailability).toEqual({
      available: false,
      reason: 'TEAM_NOT_CONFIGURED'
    })
    expect(f.calls[0].values).toEqual([projectId, accountId])
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
  })

  it('keeps a configured four-role team unavailable without actual execution isolation', async () => {
    const f = sqlFixture([[projectRow(2)], employeeRows()])
    const result = await f.repository.getTeam(accountId, projectId)
    expect(result.employees.map((employee) => employee.binding.role)).toEqual(
      employees.map((employee) => employee.role)
    )
    expect(new Set(result.employees.map((employee) => employee.binding.employeeRef)).size).toBe(4)
    expect(result.executionAvailability).toEqual({
      available: false,
      reason: 'EXECUTION_ISOLATION_UNAVAILABLE'
    })
    expect(JSON.stringify(result)).not.toContain('adapter_config')
  })

  it('denies a foreign project before reading employee state', async () => {
    const f = sqlFixture([[]])
    await expect(f.repository.getTeam('foreign-account', projectId)).rejects.toThrow('FORBIDDEN')
    expect(f.calls).toHaveLength(1)
  })

  it.each([
    { adapter_type: 'codex_local' },
    { upstream_role: 'engineer' },
    { adapter_config: { command: 'must-not-run' } },
    { binding_revision: 99 }
  ])('refuses uncontrolled or stale upstream employee configuration', async (change) => {
    const rows = employeeRows()
    rows[0] = { ...rows[0], ...change }
    const f = sqlFixture([[projectRow(2)], rows])
    await expect(f.repository.getTeam(accountId, projectId)).rejects.toThrow('REVISION_CONFLICT')
  })

  it('refuses a partial persisted team rather than inventing missing roles', async () => {
    const f = sqlFixture([[projectRow(2)], employeeRows().slice(0, 3)])
    await expect(f.repository.getTeam(accountId, projectId)).rejects.toThrow()
  })

  it('rejects stale optimistic revisions before modifying any agent', async () => {
    const f = sqlFixture([[], [], [projectRow(2)]])
    await expect(f.repository.configureTeam(accountId, teamInput())).rejects.toThrow(
      'REVISION_CONFLICT'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('updates the four existing employees in place and atomically advances project revision', async () => {
    const input = teamInput(2)
    const existing = employees.map((employee) => ({
      employee_id: employeeIds[employee.role],
      role: employee.role
    }))
    const replies = [[], [], [projectRow(2)], existing]
    for (const employee of employees) {
      replies.push([{ id: employeeIds[employee.role] }], [])
    }
    replies.push([{ project_id: projectId }], [projectRow(3)], employeeRows(3), [])
    const f = sqlFixture(replies)
    const result = await f.repository.configureTeam(accountId, input)
    expect(result.project.binding.bindingRevision).toBe(3)
    expect(result.employees.map((employee) => employee.binding.employeeRef)).toEqual(
      employees.map((employee) => employeeIds[employee.role])
    )
    expect(result.employees.every((employee) => employee.binding.bindingRevision === 3)).toBe(true)
    expect(f.writes().filter((query) => query.text.startsWith('INSERT INTO agents'))).toHaveLength(
      0
    )
    expect(f.writes().filter((query) => query.text.startsWith('UPDATE agents'))).toHaveLength(4)
    expect(f.calls[2].text).toContain('FOR UPDATE OF p,pb FOR SHARE OF c,cb')
    expect(
      f.writes().find((query) => query.text.startsWith('UPDATE hive_workbench_project_bindings'))
        .values
    ).toEqual([3, projectId, companyId, 2])
    expect(f.writes().at(-1).values.at(-1)).toEqual(result)
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
  })

  it('inserts exactly four upstream agents for the first configuration', async () => {
    const input = teamInput()
    const minted = []
    const replies = [[], [], [projectRow()], []]
    for (const employee of employees) {
      replies.push([], ({ values }) => {
        minted.push({
          ...employeeRows()[employees.findIndex((item) => item.role === employee.role)],
          employee_id: values[0]
        })
        return []
      })
    }
    replies.push([{ project_id: projectId }], [projectRow(2)], () => minted, [])
    const f = sqlFixture(replies)
    const result = await f.repository.configureTeam(accountId, input)
    expect(result.project.binding.bindingRevision).toBe(2)
    expect(new Set(result.employees.map((employee) => employee.binding.employeeRef)).size).toBe(4)
    const insertions = f.writes().filter((query) => query.text.startsWith('INSERT INTO agents'))
    expect(insertions).toHaveLength(4)
    expect(insertions.every((query) => query.text.includes("'hive_runtime','{}'::jsonb"))).toBe(
      true
    )
    expect(insertions.map((query) => query.values.slice(1))).toEqual(
      employees.map((employee) => [
        companyId,
        employee.name,
        { product: 'pm', developer: 'engineer', tester: 'qa', ops: 'devops' }[employee.role]
      ])
    )
  })

  it('replays a successful team request without checking the now-outdated expectedRevision', async () => {
    const source = sqlFixture([[projectRow(2)], employeeRows()])
    const original = await source.repository.getTeam(accountId, projectId)
    const input = teamInput()
    const f = sqlFixture([[], [receipt('team.configure', input, original)], [companyRow()]])
    expect(await f.repository.configureTeam(accountId, input)).toEqual(original)
    expect(f.writes()).toHaveLength(0)
  })

  it('replays the same team request across UUID case changes without another write', async () => {
    const source = sqlFixture([[projectRow(2)], employeeRows()])
    const original = await source.repository.getTeam(accountId, projectId)
    const input = { ...teamInput(), requestId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa' }
    const f = sqlFixture([[], [receipt('team.configure', input, original)], [companyRow()]])
    expect(
      await f.repository.configureTeam(accountId, {
        ...input,
        requestId: input.requestId.toUpperCase(),
        projectId: input.projectId.toUpperCase()
      })
    ).toEqual(original)
    expect(f.writes()).toHaveLength(0)
    expect(f.calls[1].values).toEqual([accountId, input.requestId])
  })

  it('aborts a conflicting project revision update instead of emitting a successful receipt', async () => {
    const input = teamInput()
    const replies = [[], [], [projectRow()], []]
    for (const _employee of employees) {
      replies.push([], [])
    }
    replies.push([])
    const f = sqlFixture(replies)
    await expect(f.repository.configureTeam(accountId, input)).rejects.toThrow('REVISION_CONFLICT')
    expect(f.writes().some((query) => query.text.includes('hive_workbench_request_receipts'))).toBe(
      false
    )
  })

  it('rejects a changed or partial employee configuration before opening a transaction', async () => {
    const f = sqlFixture()
    await expect(
      f.repository.configureTeam(accountId, {
        ...teamInput(),
        employees: [employees[0], employees[0], employees[2], employees[3]]
      })
    ).rejects.toThrow()
    expect(f.sql.begin).not.toHaveBeenCalled()
  })
})
