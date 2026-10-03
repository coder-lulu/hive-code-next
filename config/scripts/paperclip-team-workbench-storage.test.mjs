import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe.skipIf(!process.env.HIVE_PAPERCLIP_TEST_CONFIG)(
  'isolated real Paperclip team workbench storage and HTTP boundaries',
  () => {
    let sql, descriptor, company, project, configured, configuredInput
    const account = `team-contract:${randomUUID()}`
    const foreign = `team-contract:${randomUUID()}`
    const createdCompanies = []
    const createdProjects = []
    const employees = ['product', 'developer', 'tester', 'ops'].map((role) => ({
      role,
      name: `AI ${role}`,
      profileRef: 'codex',
      profileRevision: 'codex:1'
    }))
    beforeAll(async () => {
      const config = JSON.parse(
        await readFile(resolve(process.env.HIVE_PAPERCLIP_TEST_CONFIG), 'utf8')
      )
      const database = new URL(config.databaseUrl)
      if (
        typeof config.containerName !== 'string' ||
        !config.containerName.startsWith('hive-paperclip-') ||
        database.hostname !== '127.0.0.1' ||
        database.pathname !== '/hive_tasks'
      ) {
        throw new Error('An isolated loopback Paperclip test database is required')
      }
      const requireDb = createRequire(
        resolve(
          process.env.HIVE_PAPERCLIP_SOURCE ?? 'logs/paperclip-p1/paperclip',
          'packages/db/package.json'
        )
      )
      sql = requireDb('postgres')(config.databaseUrl, { max: 4, onnotice: () => {} })
      descriptor = JSON.parse(await readFile(config.serviceDescriptor, 'utf8'))
      const serviceUrl = new URL(descriptor.baseUrl)
      if (serviceUrl.protocol !== 'http:' || serviceUrl.hostname !== '127.0.0.1') {
        throw new Error('An isolated loopback Paperclip test service is required')
      }
    })
    afterAll(async () => {
      await sql?.end({ timeout: 5 })
    })
    const request = async (path, body, identity = account) => {
      const response = await fetch(`${descriptor.baseUrl}/hive/workbench/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${descriptor.secret}`,
          'Content-Type': 'application/json',
          'X-Hive-Account-Id': identity
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      return { status: response.status, body: await response.json() }
    }
    const createCompany = async (name = 'AI company') => {
      const response = await request('companies/create', { requestId: randomUUID(), name })
      expect(response.status).toBe(201)
      createdCompanies.push(response.body.id)
      return response.body
    }
    const createProject = async (name = 'AI project') => {
      const response = await request('projects/create', {
        requestId: randomUUID(),
        companyId: company.id,
        name,
        workspaceSelector: 'folder:isolated-contract',
        hiveWorkspaceRef: 'workspace:isolated-contract'
      })
      expect(response.status).toBe(201)
      createdProjects.push(response.body.id)
      return response.body
    }
    const employeeIdsByRole = (team) =>
      Object.fromEntries(
        team.employees.map((employee) => [employee.binding.role, employee.binding.employeeRef])
      )

    it('persists actual companies/projects while an unconfigured project remains unavailable', async () => {
      company = await createCompany()
      project = await createProject()
      const response = await request('team/read', { projectId: project.id })
      expect(response.status).toBe(200)
      expect(response.body.executionAvailability).toEqual({
        available: false,
        reason: 'TEAM_NOT_CONFIGURED'
      })
      const [storedCompany] = await sql`SELECT name FROM companies WHERE id=${company.id}`
      const [storedProject] = await sql`SELECT company_id,name FROM projects WHERE id=${project.id}`
      expect(storedCompany.name).toBe(company.name)
      expect(storedProject).toEqual({ company_id: company.id, name: project.name })
      expect(company.binding.ownerAccountRef).toBe(company.binding.ownerScope.tenantRef)
      expect(project.binding.hiveWorkspaceRef).toBe('workspace:isolated-contract')
    })

    it('coalesces concurrent company creation and rejects changed/cross-operation request keys', async () => {
      const input = { requestId: randomUUID(), name: 'Concurrent company' }
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => request('companies/create', input))
      )
      expect(responses.every((result) => result.status === 201)).toBe(true)
      expect(new Set(responses.map((result) => result.body.id)).size).toBe(1)
      createdCompanies.push(responses[0].body.id)
      const [count] = await sql`SELECT count(*)::int AS count FROM hive_workbench_request_receipts
        WHERE account_id=${account} AND request_id=${input.requestId}`
      expect(count.count).toBe(1)
      const changed = await request('companies/create', { ...input, name: 'Different' })
      expect(changed.status).toBe(409)
      expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
      const otherOperation = await request('projects/create', {
        requestId: input.requestId,
        companyId: company.id,
        name: 'Must not create',
        workspaceSelector: 'folder:isolated-contract',
        hiveWorkspaceRef: 'workspace:isolated-contract'
      })
      expect(otherOperation.status).toBe(409)
      expect(otherOperation.body.error.code).toBe('IDEMPOTENCY_CONFLICT')
    })

    it('rejects cross-account reads and writes even when company names match', async () => {
      const otherCompany = await request(
        'companies/create',
        { requestId: randomUUID(), name: company.name },
        foreign
      )
      expect(otherCompany.status).toBe(201)
      expect(otherCompany.body.id).not.toBe(company.id)
      const [before] = await sql`SELECT
        (SELECT count(*)::int FROM projects WHERE company_id=${company.id}) AS projects,
        (SELECT count(*)::int FROM agents WHERE company_id=${company.id}) AS agents`
      const responses = await Promise.all([
        request('projects/list', { companyId: company.id }, foreign),
        request('team/read', { projectId: project.id }, foreign),
        request(
          'projects/create',
          {
            requestId: randomUUID(),
            companyId: company.id,
            name: 'Must not create',
            workspaceSelector: 'folder:isolated-contract',
            hiveWorkspaceRef: 'workspace:isolated-contract'
          },
          foreign
        ),
        request(
          'team/configure',
          { requestId: randomUUID(), projectId: project.id, expectedRevision: 1, employees },
          foreign
        )
      ])
      expect(
        responses.every(
          (response) => response.status === 403 && response.body.error.code === 'FORBIDDEN'
        )
      ).toBe(true)
      const [after] = await sql`SELECT
        (SELECT count(*)::int FROM projects WHERE company_id=${company.id}) AS projects,
        (SELECT count(*)::int FROM agents WHERE company_id=${company.id}) AS agents`
      expect(after).toEqual(before)
      const visible = await request('companies/list', {}, foreign)
      expect(visible.body.items.map((item) => item.id)).toEqual([otherCompany.body.id])
    })

    it('creates exactly four managed upstream agents for concurrent identical configuration', async () => {
      const input = {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 1,
        employees
      }
      configuredInput = input
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => request('team/configure', input))
      )
      expect(responses.every((response) => response.status === 200)).toBe(true)
      configured = responses[0].body
      expect(
        responses.every((response) => JSON.stringify(response.body) === JSON.stringify(configured))
      ).toBe(true)
      expect(configured.project.binding.bindingRevision).toBe(2)
      expect(configured.executionAvailability).toEqual({
        available: false,
        reason: 'EXECUTION_ISOLATION_UNAVAILABLE'
      })
      const rows = await sql`SELECT a.id,a.adapter_type,a.adapter_config,a.runtime_config,a.status
        FROM agents a JOIN hive_workbench_employee_bindings b ON b.employee_id=a.id AND b.company_id=a.company_id
        WHERE b.project_id=${project.id}`
      expect(rows).toHaveLength(4)
      expect(new Set(rows.map((row) => row.id)).size).toBe(4)
      expect(
        rows.every(
          (row) =>
            row.adapter_type === 'hive_runtime' &&
            row.status === 'idle' &&
            JSON.stringify(row.adapter_config) === '{}' &&
            JSON.stringify(row.runtime_config) === '{}'
        )
      ).toBe(true)
      const replay = await request('team/configure', input)
      expect(replay.body).toEqual(configured)
    })

    it('lets only one competing revision update commit and retains all employee identities', async () => {
      const previousIds = employeeIdsByRole(configured)
      const requests = ['A', 'B'].map((suffix) => ({
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 2,
        employees: employees.map((employee) => ({
          ...employee,
          name: `${employee.name} ${suffix}`
        }))
      }))
      const responses = await Promise.all(requests.map((input) => request('team/configure', input)))
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
      expect(responses.find((response) => response.status === 409).body.error.code).toBe(
        'REVISION_CONFLICT'
      )
      const current = await request('team/read', { projectId: project.id })
      expect(current.status).toBe(200)
      expect(current.body.project.binding.bindingRevision).toBe(3)
      expect(employeeIdsByRole(current.body)).toEqual(previousIds)
      const replay = await request('team/configure', configuredInput)
      expect(replay.body).toEqual(configured)
      expect(replay.body.project.binding.bindingRevision).toBe(2)
      const [count] =
        await sql`SELECT count(*)::int AS count FROM hive_workbench_employee_bindings WHERE project_id=${project.id}`
      expect(count.count).toBe(4)
    })

    it('reads company and project limit-one keyset pages without duplicates or omissions', async () => {
      await createCompany('Company page B')
      await createCompany('Company page C')
      await createProject('Project page B')
      await createProject('Project page C')
      const collect = async (path, base) => {
        const ids = []
        let after
        for (let page = 0; page < 20; page++) {
          const response = await request(path, { ...base, limit: 1, ...(after ? { after } : {}) })
          expect(response.status).toBe(200)
          expect(response.body.items.length).toBeLessThanOrEqual(1)
          ids.push(...response.body.items.map((item) => item.id))
          if (!response.body.nextCursor) {
            return ids
          }
          after = response.body.nextCursor
        }
        throw new Error('Pagination did not reach its final page')
      }
      expect(await collect('companies/list', {})).toEqual([...createdCompanies].sort())
      expect(await collect('projects/list', { companyId: company.id })).toEqual(
        [...createdProjects].sort()
      )
    })

    it('rejects tampered execution configuration without launching or exposing it', async () => {
      const employeeId = Object.values(employeeIdsByRole(configured))[0]
      try {
        await sql`UPDATE agents SET adapter_config=${sql.json({ command: 'must-not-run' })}
          WHERE id=${employeeId} AND company_id=${company.id}`
        const response = await request('team/read', { projectId: project.id })
        expect(response.status).toBe(409)
        expect(response.body.error.code).toBe('REVISION_CONFLICT')
        expect(JSON.stringify(response.body)).not.toContain('must-not-run')
      } finally {
        await sql`UPDATE agents SET adapter_config='{}'::jsonb WHERE id=${employeeId} AND company_id=${company.id}`
      }
    })

    it('rejects a changed upstream responsibility instead of silently retaining the role binding', async () => {
      const employeeId = employeeIdsByRole(configured).product
      try {
        await sql`UPDATE agents SET role='engineer' WHERE id=${employeeId} AND company_id=${company.id}`
        const response = await request('team/read', { projectId: project.id })
        expect(response.status).toBe(409)
        expect(response.body.error.code).toBe('REVISION_CONFLICT')
      } finally {
        await sql`UPDATE agents SET role='pm' WHERE id=${employeeId} AND company_id=${company.id}`
      }
      const restored = await request('team/read', { projectId: project.id })
      expect(restored.status).toBe(200)
      expect(employeeIdsByRole(restored.body)).toEqual(employeeIdsByRole(configured))
    })

    it('company/project/team setup never creates issues, runs or implicit execution state', async () => {
      const [counts] = await sql`SELECT
        (SELECT count(*)::int FROM issues i JOIN hive_workbench_company_bindings b ON b.company_id=i.company_id WHERE b.account_id=${account}) AS issues,
        (SELECT count(*)::int FROM heartbeat_runs h JOIN hive_workbench_company_bindings b ON b.company_id=h.company_id WHERE b.account_id=${account}) AS runs,
        (SELECT count(*)::int FROM agents a JOIN hive_workbench_company_bindings b ON b.company_id=a.company_id
          WHERE b.account_id=${account} AND (a.status <> 'idle' OR a.last_heartbeat_at IS NOT NULL)) AS active_agents`
      expect(counts).toEqual({ issues: 0, runs: 0, active_agents: 0 })
      const dispatch = await request('team/dispatch', { projectId: project.id })
      expect(dispatch.status).toBe(403)
      expect(dispatch.body.error.code).toBe('FORBIDDEN')
    })
  }
)
