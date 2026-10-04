import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { HiveWorkflowCaseCreateReplySchema } from '../../src/shared/hive-workflow-cases.ts'
import { createHiveTaskFacade } from '../../src/main/tasks/hive-task-facade.ts'
import { TaskArtifactIndex } from '../../src/main/tasks/task-artifact-index.ts'

describe.skipIf(!process.env.HIVE_PAPERCLIP_TEST_CONFIG)(
  'real requirement case HTTP admission boundaries',
  () => {
    let sql, descriptor, descriptorPath, company, project, workflow, input
    const account = `workflow-case-http:${randomUUID()}`
    beforeAll(async () => {
      const config = JSON.parse(
        await readFile(resolve(process.env.HIVE_PAPERCLIP_TEST_CONFIG), 'utf8')
      )
      const database = new URL(config.databaseUrl)
      if (
        config.containerName !== 'hive-paperclip-p1-p2-validation-d2861510ba' ||
        database.hostname !== '127.0.0.1' ||
        database.port !== '63555' ||
        database.pathname !== '/hive_tasks'
      ) {
        throw new Error('Dedicated loopback PostgreSQL is required')
      }
      const requireDb = createRequire(
        resolve('logs/paperclip-p1/paperclip/packages/db/package.json')
      )
      sql = requireDb('postgres')(config.databaseUrl, { max: 4, onnotice: () => {} })
      descriptorPath = config.serviceDescriptor
      descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'))
      const service = new URL(descriptor.baseUrl)
      if (service.protocol !== 'http:' || service.hostname !== '127.0.0.1') {
        throw new Error('Dedicated loopback service is required')
      }
      company = (
        await request('companies/create', { requestId: randomUUID(), name: 'Case HTTP fixture' })
      ).body
      project = (
        await request('projects/create', {
          requestId: randomUUID(),
          companyId: company.id,
          name: 'Case admission project',
          workspaceSelector: 'folder:case-http',
          hiveWorkspaceRef: 'workspace:case-http'
        })
      ).body
      const configured = await request('team/configure', {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 1,
        employees: ['product', 'developer', 'tester', 'ops'].map((role) => ({
          role,
          name: role,
          profileRef: 'codex',
          profileRevision: 'codex:1'
        }))
      })
      expect(configured.status).toBe(200)
      const saved = await request('workflows/save', {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 0,
        expectedProjectRevision: 2,
        name: 'HTTP fixed workflow',
        stages: structuredClone(workflowTestVectors.examples.definition.stages),
        maxParallelism: 1,
        maxDurationMs: 60_000
      })
      expect(saved.status).toBe(200)
      workflow = saved.body
      input = {
        requestId: randomUUID(),
        projectId: project.id,
        workflowId: workflow.workflowId,
        workflowRevision: 1,
        definitionDigest: workflow.definitionDigest,
        expectedProjectRevision: 2,
        title: 'HTTP requirement',
        requirement: 'Implement a feature with independent testing.'
      }
    })
    afterAll(async () => sql?.end({ timeout: 5 }))

    async function request(path, body, identity = account, rawBody) {
      const response = await fetch(`${descriptor.baseUrl}/hive/workbench/${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${descriptor.secret}`,
          'Content-Type': 'application/json',
          'X-Hive-Account-Id': identity
        },
        body: rawBody ?? JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      return { status: response.status, body: await response.json() }
    }
    async function counts() {
      const [row] = await sql`SELECT issue_counter,
        (SELECT count(*)::integer FROM issues WHERE company_id=${company.id}) AS issues,
        (SELECT count(*)::integer FROM pipeline_cases WHERE company_id=${company.id}) AS cases,
        (SELECT count(*)::integer FROM hive_workbench_request_receipts WHERE company_id=${company.id}) AS receipts,
        (SELECT count(*)::integer FROM heartbeat_runs WHERE company_id=${company.id}) AS heartbeats
        FROM companies WHERE id=${company.id}`
      return row
    }

    async function mainFacade() {
      const artifactsDirectory = resolve(
        'logs/paperclip-development/p3/http/facade-artifacts',
        randomUUID()
      )
      await mkdir(artifactsDirectory, { recursive: true })
      const caller = {
        accountId: account,
        authorityId: 'http-fixture',
        accessToken: 'synthetic-fixture',
        sessionGeneration: 1,
        sessionExpiresAt: Date.now() + 60_000
      }
      return createHiveTaskFacade({
        descriptorPath,
        artifacts: new TaskArtifactIndex(artifactsDirectory),
        issuer: {
          issue() {
            throw new Error('Execution must remain unavailable')
          }
        },
        currentAccount: () => caller,
        assertCurrent() {},
        validateWorkspace: async (selector) => {
          if (selector !== project.workspaceSelector) {
            throw new Error('FORBIDDEN')
          }
          return { workspaceRef: project.binding.hiveWorkspaceRef, assertCurrent() {} }
        }
      })
    }

    it.each([
      ['CJK', '需'.repeat(48_000)],
      ['JSON escapes', '\u0001'.repeat(48_000)],
      ['emoji UTF-16 limit', '🐝'.repeat(24_000)]
    ])(
      'persists a schema-valid maximum-length %s requirement over real HTTP',
      async (_kind, requirement) => {
        const value = { ...input, requestId: randomUUID(), requirement }
        expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(64 * 1024)
        const before = await counts()
        const created = await request('cases/create', value)
        expect(created.status).toBe(201)
        const { admission, view } = HiveWorkflowCaseCreateReplySchema.parse(created.body)
        expect(admission).toMatchObject({
          requestId: value.requestId,
          caseId: view.id,
          replayed: false
        })
        expect(view.requirement).toBe(requirement)
        const read = await request('cases/read', { projectId: project.id, caseId: view.id })
        expect(read).toEqual({ status: 200, body: view })
        const replay = await request('cases/create', value)
        expect(replay).toEqual({
          status: 201,
          body: { admission: { ...admission, replayed: true }, view }
        })
        expect(await counts()).toEqual({
          issue_counter: before.issue_counter + 5,
          issues: before.issues + 5,
          cases: before.cases + 1,
          receipts: before.receipts + 1,
          heartbeats: 0
        })
      }
    )

    it('normalizes input UUID aliases before committed workflow and case replay without changing snapshots', async () => {
      const value = { ...input, requestId: randomUUID() }
      const created = await request('cases/create', {
        ...value,
        requestId: value.requestId.toUpperCase(),
        projectId: value.projectId.toUpperCase(),
        workflowId: value.workflowId.toUpperCase()
      })
      expect(created.status).toBe(201)
      const { admission, view } = HiveWorkflowCaseCreateReplySchema.parse(created.body)
      expect(admission.replayed).toBe(false)
      expect(await request('cases/create', value)).toEqual({
        status: 201,
        body: { admission: { ...admission, replayed: true }, view }
      })
      expect(
        await request('cases/read', {
          projectId: project.id.toUpperCase(),
          caseId: view.id.toUpperCase()
        })
      ).toEqual({ status: 200, body: view })
      const definition = await request('workflows/read', {
        projectId: project.id.toUpperCase(),
        workflowId: workflow.workflowId.toUpperCase(),
        revision: 1
      })
      expect(definition).toEqual({ status: 200, body: workflow })
      const list = await request('cases/list', {
        projectId: project.id.toUpperCase(),
        workflowId: workflow.workflowId.toUpperCase()
      })
      expect(list.status).toBe(200)
      expect(list.body.items.some((item) => item.id === view.id)).toBe(true)
    })

    it('rejects a foreign owner without adding a case, Issue, receipt or execution', async () => {
      const before = await counts()
      const result = await request(
        'cases/create',
        { ...input, requestId: randomUUID() },
        `foreign:${randomUUID()}`
      )
      expect(result).toEqual({ status: 403, body: { error: { code: 'FORBIDDEN' } } })
      expect(await counts()).toEqual(before)
    })

    it('rejects oversized bodies before admission and preserves the existing small-body route limit', async () => {
      const before = await counts()
      const oversized =
        JSON.stringify({ ...input, requestId: randomUUID() }) + ' '.repeat(320 * 1024)
      const denied = await request('cases/create', undefined, account, oversized)
      expect(denied).toEqual({ status: 413, body: { error: { code: 'INVALID_REQUEST' } } })
      const other = await request(
        'cases/read',
        undefined,
        account,
        JSON.stringify({ projectId: project.id, caseId: randomUUID() }) + ' '.repeat(64 * 1024)
      )
      expect(other).toEqual({ status: 413, body: { error: { code: 'INVALID_REQUEST' } } })
      expect(await counts()).toEqual(before)
      expect((await request('cases/create', { ...input, requestId: randomUUID() })).status).toBe(
        201
      )
    })

    it('recovers a committed request through real Main and HTTP after business title and requirement edits', async () => {
      const facade = await mainFacade()
      const value = { ...input, requestId: randomUUID() }
      const before = await counts()
      const created = await facade.createWorkflowCase(value)
      await sql`UPDATE pipeline_cases SET title='Updated live business title',version=version+1,updated_at=now() WHERE id=${created.id}`
      await sql`UPDATE issues SET description='Updated live requirement' WHERE id=${created.originTaskId}`
      const recovered = await facade.createWorkflowCase(value)
      expect(recovered).toMatchObject({
        id: created.id,
        title: 'Updated live business title',
        requirement: 'Updated live requirement',
        revision: 2
      })
      expect(recovered.team).toEqual(created.team)
      expect(recovered.workflow).toEqual(created.workflow)
      expect(await facade.getWorkflowCase({ projectId: project.id, caseId: created.id })).toEqual(
        recovered
      )
      const expected = {
        issue_counter: before.issue_counter + 5,
        issues: before.issues + 5,
        cases: before.cases + 1,
        receipts: before.receipts + 1,
        heartbeats: 0
      }
      expect(await counts()).toEqual(expected)
      await expect(
        facade.createWorkflowCase({ ...value, requirement: 'Changed admission' })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect(await counts()).toEqual(expected)
    })

    it('recovers a saved definition after team reconfiguration while a new stale request cannot write', async () => {
      const facade = await mainFacade()
      const save = {
        requestId: randomUUID(),
        projectId: project.id,
        workflowId: workflow.workflowId,
        expectedRevision: 1,
        expectedProjectRevision: 2,
        name: `${workflow.name} revised`,
        stages: workflow.definition.stages,
        maxParallelism: workflow.definition.maxParallelism,
        maxDurationMs: workflow.definition.maxDurationMs
      }
      const saved = await facade.saveWorkflow(save)
      expect(saved.definition.workflowRevision).toBe(2)
      const configured = await request('team/configure', {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 2,
        employees: ['product', 'developer', 'tester', 'ops'].map((role) => ({
          role,
          name: `${role} changed`,
          profileRef: 'codex',
          profileRevision: 'codex:1'
        }))
      })
      expect(configured.status).toBe(200)
      expect(configured.body.project.binding.bindingRevision).toBe(3)
      const before = await counts()
      expect(await facade.saveWorkflow(save)).toEqual(saved)
      await expect(facade.saveWorkflow({ ...save, requestId: randomUUID() })).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      expect(await counts()).toEqual(before)
      const [versions] =
        await sql`SELECT count(*)::int AS count FROM hive_workflow_definition_revisions WHERE workflow_id=${workflow.workflowId}`
      expect(versions.count).toBe(2)
      const historical = await facade.getWorkflow({
        projectId: project.id,
        workflowId: workflow.workflowId,
        revision: 1
      })
      expect(historical).toEqual({ ...workflow, projectBindingRevision: 3 })
      const oldDefinitionCase = await facade.createWorkflowCase({
        ...input,
        requestId: randomUUID(),
        expectedProjectRevision: 3
      })
      expect(oldDefinitionCase.workflow).toEqual(historical)
      expect(oldDefinitionCase.team.project.bindingRevision).toBe(3)
      expect(oldDefinitionCase.stageTasks.map((task) => task.role)).toEqual([
        'product',
        'developer',
        'tester',
        'ops'
      ])
      expect(await counts()).toEqual({
        issue_counter: before.issue_counter + 5,
        issues: before.issues + 5,
        cases: before.cases + 1,
        receipts: before.receipts + 1,
        heartbeats: 0
      })
    })
  }
)
