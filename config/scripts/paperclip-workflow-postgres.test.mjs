import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { createTeamWorkbenchRepository } from '../../integration/paperclip/service/team-workbench-repository.mjs'
import { createWorkflowDefinitionRepository } from '../../integration/paperclip/service/workflow-definition-repository.mjs'
import { workflowTestVectors } from '../../src/shared/task-workflow/workflow.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)(
  'immutable engineering workflows in actual Paperclip PostgreSQL',
  () => {
    let h, workbench, workflows
    beforeAll(async () => {
      h = await createPostgresTaskHarness(configPath)
      for (const file of ['team-workbench-tables.sql', 'workflow-definition-tables.sql']) {
        await h.sql.unsafe(
          await readFile(
            new URL(`../../integration/paperclip/service/${file}`, import.meta.url),
            'utf8'
          )
        )
      }
      workbench = createTeamWorkbenchRepository(h.sql)
      workflows = createWorkflowDefinitionRepository(h.sql)
    })
    afterAll(async () => h?.close())
    async function fixture() {
      const accountId = `workflow-postgres:${randomUUID()}`
      const company = await workbench.createCompany(accountId, {
        requestId: randomUUID(),
        name: 'Workflow fixture'
      })
      const project = await workbench.createProject(accountId, {
        requestId: randomUUID(),
        companyId: company.id,
        name: 'Engineering project',
        workspaceSelector: 'folder:workflow-fixture',
        hiveWorkspaceRef: `workspace:${randomUUID()}`
      })
      const input = {
        requestId: randomUUID(),
        projectId: project.id,
        expectedRevision: 0,
        expectedProjectRevision: 1,
        name: 'Product to release preparation',
        stages: structuredClone(workflowTestVectors.examples.definition.stages),
        maxParallelism: 1,
        maxDurationMs: 60_000
      }
      const read = (workflowId, revision) =>
        workflows.getWorkflow(accountId, { projectId: project.id, workflowId, revision })
      return { accountId, company, project, input, read }
    }
    async function pipelineCount(companyId) {
      const [row] =
        await h.sql`SELECT count(*)::integer AS count FROM pipelines WHERE company_id=${companyId}`
      return row.count
    }

    it.each(['', ' \t\r\n'])(
      'rejects blank acceptance criteria %j before writing a graph',
      async (criterion) => {
        const f = await fixture()
        f.input.stages[1].acceptanceCriteria = [criterion]
        await expect(workflows.saveWorkflow(f.accountId, f.input)).rejects.toThrow(
          'workflow_definition_invalid'
        )
        expect(await pipelineCount(f.company.id)).toBe(0)
        expect(await workflows.listWorkflows(f.accountId, { projectId: f.project.id })).toEqual({
          items: [],
          nextCursor: null
        })
      }
    )

    it('stores the real upstream stage/transition graph without starting any execution', async () => {
      const f = await fixture()
      const saved = await workflows.saveWorkflow(f.accountId, f.input)
      expect(await f.read(saved.workflowId)).toEqual(saved)
      const [pipeline] = await h.sql`SELECT * FROM pipelines WHERE id=${saved.workflowId}`
      expect(pipeline).toMatchObject({
        company_id: f.company.id,
        project_id: f.project.id,
        enforce_transitions: true
      })
      const stages =
        await h.sql`SELECT kind,config FROM pipeline_stages WHERE pipeline_id=${saved.workflowId}`
      expect(stages).toHaveLength(f.input.stages.length + 2)
      expect(stages.every((stage) => Object.keys(stage.config).join() === 'hiveWorkflow')).toBe(
        true
      )
      const [facts] = await h.sql`SELECT
      (SELECT count(*) FROM issues WHERE company_id=${f.company.id})::integer AS issues,
      (SELECT count(*) FROM heartbeat_runs WHERE company_id=${f.company.id})::integer AS executions,
      (SELECT count(*) FROM pipeline_cases WHERE company_id=${f.company.id})::integer AS cases`
      expect(facts).toEqual({ issues: 0, executions: 0, cases: 0 })
    })

    it('coalesces identical requests and rejects changed or cross-operation reuse', async () => {
      const f = await fixture()
      const saves = await Promise.all(
        Array.from({ length: 5 }, () => workflows.saveWorkflow(f.accountId, f.input))
      )
      expect(new Set(saves.map((saved) => saved.workflowId)).size).toBe(1)
      expect(await pipelineCount(f.company.id)).toBe(1)
      const audit =
        await h.sql`SELECT actor_type,actor_id,action,details FROM activity_log WHERE company_id=${f.company.id}`
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({
        actor_type: 'user',
        actor_id: `actor:${digest(f.accountId)}`,
        action: 'hive.workflow.definition_saved',
        details: { workflowId: saves[0].workflowId, workflowRevision: 1 }
      })
      await expect(
        workflows.saveWorkflow(f.accountId, { ...f.input, name: 'Different' })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      await expect(
        workbench.createCompany(f.accountId, {
          requestId: f.input.requestId,
          name: 'Different operation'
        })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect(await pipelineCount(f.company.id)).toBe(1)
    })

    it('refuses a replay receipt that contradicts the immutable requested definition', async () => {
      const f = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      const changed = { ...first, name: 'Forged replay' }
      changed.definitionDigest = digest({ name: changed.name, definition: changed.definition })
      await h.sql`UPDATE hive_workbench_request_receipts SET response_json=${h.sql.json(changed)}
      WHERE account_id=${f.accountId} AND request_id=${f.input.requestId}`
      await expect(workflows.saveWorkflow(f.accountId, f.input)).rejects.toThrow(
        'REVISION_CONFLICT'
      )
      expect(await f.read(first.workflowId)).toEqual(first)
      expect(await pipelineCount(f.company.id)).toBe(1)
    })

    it('creates a new Pipeline per revision while retaining the original graph and digest', async () => {
      const f = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      const original =
        await h.sql`SELECT * FROM pipeline_stages WHERE pipeline_id=${first.workflowId} ORDER BY position`
      const second = await workflows.saveWorkflow(f.accountId, {
        ...f.input,
        requestId: randomUUID(),
        workflowId: first.workflowId,
        expectedRevision: 1,
        name: 'Revised workflow',
        maxParallelism: 2
      })
      expect(second.workflowId).toBe(first.workflowId)
      expect(second.definition.workflowRevision).toBe(2)
      expect(second.definitionDigest).not.toBe(first.definitionDigest)
      expect(await f.read(first.workflowId, 1)).toEqual(first)
      expect(await f.read(first.workflowId)).toEqual(second)
      expect(
        await h.sql`SELECT * FROM pipeline_stages WHERE pipeline_id=${first.workflowId} ORDER BY position`
      ).toEqual(original)
      expect(await pipelineCount(f.company.id)).toBe(2)
    })

    it('commits one concurrent revision and rolls back all losing writers', async () => {
      const f = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      const changes = await Promise.allSettled(
        Array.from({ length: 4 }, (_, index) =>
          workflows.saveWorkflow(f.accountId, {
            ...f.input,
            requestId: randomUUID(),
            workflowId: first.workflowId,
            expectedRevision: 1,
            name: `Concurrent ${index}`
          })
        )
      )
      expect(changes.filter((change) => change.status === 'fulfilled')).toHaveLength(1)
      expect(
        changes
          .filter((change) => change.status === 'rejected')
          .every((change) => change.reason.code === 'REVISION_CONFLICT')
      ).toBe(true)
      expect(await pipelineCount(f.company.id)).toBe(2)
      expect((await f.read(first.workflowId)).definition.workflowRevision).toBe(2)
    })

    it('rejects foreign accounts, project scopes and unknown revisions without leaking definitions', async () => {
      const f = await fixture(),
        foreign = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      await expect(
        workflows.getWorkflow(foreign.accountId, {
          projectId: f.project.id,
          workflowId: first.workflowId
        })
      ).rejects.toThrow('FORBIDDEN')
      await expect(
        workflows.listWorkflows(foreign.accountId, { projectId: f.project.id })
      ).rejects.toThrow('FORBIDDEN')
      await expect(
        workflows.getWorkflow(foreign.accountId, {
          projectId: foreign.project.id,
          workflowId: first.workflowId
        })
      ).rejects.toThrow('FORBIDDEN')
      await expect(f.read(first.workflowId, 3)).rejects.toThrow('FORBIDDEN')
      expect(
        await workflows.listWorkflows(foreign.accountId, { projectId: foreign.project.id })
      ).toEqual({ items: [], nextCursor: null })
    })

    it('refuses a stale project binding before creating a new revision', async () => {
      const f = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      await workbench.configureTeam(f.accountId, {
        requestId: randomUUID(),
        projectId: f.project.id,
        expectedRevision: 1,
        employees: ['product', 'developer', 'tester', 'ops'].map((role) => ({
          role,
          name: role,
          profileRef: 'codex',
          profileRevision: 'codex:1'
        }))
      })
      await expect(
        workflows.saveWorkflow(f.accountId, {
          ...f.input,
          requestId: randomUUID(),
          workflowId: first.workflowId,
          expectedRevision: 1
        })
      ).rejects.toThrow('REVISION_CONFLICT')
      expect(await pipelineCount(f.company.id)).toBe(1)
      expect((await f.read(first.workflowId)).projectBindingRevision).toBe(2)
    })

    it('enforces revision immutability in PostgreSQL itself', async () => {
      const f = await fixture()
      const first = await workflows.saveWorkflow(f.accountId, f.input)
      await expect(
        h.sql`UPDATE hive_workflow_definition_revisions SET definition_digest=${'0'.repeat(64)} WHERE workflow_id=${first.workflowId}`
      ).rejects.toMatchObject({ code: '23514' })
      await expect(
        h.sql`DELETE FROM hive_workflow_definition_revisions WHERE workflow_id=${first.workflowId}`
      ).rejects.toMatchObject({ code: '23514' })
      expect(await f.read(first.workflowId)).toEqual(first)
    })

    it.each(['name', 'stage_config', 'transition', 'extra_stage', 'archive'])(
      'rejects upstream %s drift rather than overwriting it',
      async (kind) => {
        const f = await fixture()
        const first = await workflows.saveWorkflow(f.accountId, f.input)
        if (kind === 'name') {
          await h.sql`UPDATE pipelines SET name='Changed outside Hive' WHERE id=${first.workflowId}`
        } else if (kind === 'archive') {
          await h.sql`UPDATE pipelines SET archived_at=now() WHERE id=${first.workflowId}`
        } else if (kind === 'stage_config') {
          await h.sql`UPDATE pipeline_stages SET config='{"automation":{"instructions":"untrusted"}}'::jsonb WHERE pipeline_id=${first.workflowId}`
        } else if (kind === 'transition') {
          await h.sql`DELETE FROM pipeline_transitions WHERE pipeline_id=${first.workflowId}`
        } else {
          await h.sql`INSERT INTO pipeline_stages(pipeline_id,key,name,kind,position,config) VALUES(${first.workflowId},'extra','Extra','working',99,'{}')`
        }
        await expect(f.read(first.workflowId)).rejects.toThrow('REVISION_CONFLICT')
        await expect(
          workflows.saveWorkflow(f.accountId, {
            ...f.input,
            requestId: randomUUID(),
            workflowId: first.workflowId,
            expectedRevision: 1
          })
        ).rejects.toThrow('REVISION_CONFLICT')
        expect(await pipelineCount(f.company.id)).toBe(1)
      }
    )

    it('rolls back invalid dependency graphs and refuses excess definition bytes before graph writes', async () => {
      const f = await fixture()
      const cycle = structuredClone(f.input)
      cycle.stages[0].dependsOn = [cycle.stages.at(-1).stageRef]
      await expect(workflows.saveWorkflow(f.accountId, cycle)).rejects.toThrow(
        'workflow_dependency_cycle'
      )
      const large = structuredClone(f.input)
      large.stages.forEach((stage) => {
        stage.acceptanceCriteria = Array(16).fill('x'.repeat(1500))
      })
      await expect(workflows.saveWorkflow(f.accountId, large)).rejects.toThrow('INVALID_REQUEST')
      expect(await pipelineCount(f.company.id)).toBe(0)
    })

    it('returns bounded pages with an exact continuation when definitions reach the client byte budget', async () => {
      const f = await fixture()
      const input = structuredClone(f.input)
      input.stages.forEach((stage) => {
        stage.acceptanceCriteria = Array(8).fill('x'.repeat(1500))
      })
      const created = []
      for (let index = 0; index < 9; index++) {
        created.push(
          await workflows.saveWorkflow(f.accountId, {
            ...input,
            requestId: randomUUID(),
            name: `Large ${index}`
          })
        )
      }
      const first = await workflows.listWorkflows(f.accountId, {
        projectId: f.project.id,
        limit: 50
      })
      expect(first.items.length).toBeLessThan(9)
      expect(first.nextCursor).toBe(first.items.at(-1).workflowId)
      expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(512 * 1024)
      const second = await workflows.listWorkflows(f.accountId, {
        projectId: f.project.id,
        limit: 50,
        after: first.nextCursor
      })
      expect(second.nextCursor).toBeNull()
      const ids = [...first.items, ...second.items].map((item) => item.workflowId)
      expect(new Set(ids).size).toBe(9)
      expect(ids.toSorted()).toEqual(created.map((item) => item.workflowId).toSorted())
    })
  }
)
