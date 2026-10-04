import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('real PostgreSQL external controller identity', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.close()
  })

  it('derives the exact account/task from company/run without changing any execution row', async () => {
    const context = await h.newTask()
    const before = await h.snapshot(context)
    expect(
      await h.repository.resolveExternalExecution(context.task.company_id, context.task.run_id)
    ).toEqual({
      accountId: context.accountId,
      taskId: context.task.id,
      companyId: context.task.company_id,
      runId: context.task.run_id
    })
    await expect(
      h.repository.resolveExternalExecution(randomUUID(), context.task.run_id)
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      h.repository.resolveExternalExecution(context.task.company_id, randomUUID())
    ).rejects.toThrow('FORBIDDEN')
    expect(await h.snapshot(context)).toEqual(before)
  })

  it.each(['driver', 'run_company', 'agent_company', 'account_company', 'assignee', 'binding'])(
    'rejects a persisted %s mismatch before control',
    async (kind) => {
      const context = await h.newTask(),
        other = await h.newTask()
      if (kind === 'driver') {
        await h.sql`UPDATE heartbeat_runs SET driver_kind='codex_local' WHERE id=${context.task.run_id}`
      } else if (kind === 'run_company') {
        await h.sql`UPDATE heartbeat_runs SET company_id=${other.task.company_id} WHERE id=${context.task.run_id}`
      } else if (kind === 'agent_company') {
        await h.sql`UPDATE agents SET company_id=${other.task.company_id} WHERE id=${context.task.agent_id}`
      } else if (kind === 'account_company') {
        const unboundCompanyId = randomUUID()
        await h.sql`INSERT INTO companies(id,name,issue_prefix,feedback_data_sharing_enabled)
        VALUES(${unboundCompanyId},'Synthetic controller scope',${`CTL${randomUUID().replaceAll('-', '').slice(0, 20)}`},false)`
        await h.sql`UPDATE hive_task_accounts SET company_id=${unboundCompanyId} WHERE account_id=${context.accountId}`
      } else if (kind === 'assignee') {
        await h.sql`UPDATE issues SET assignee_agent_id=${other.task.agent_id} WHERE id=${context.task.id}`
      } else {
        const binding = {
          ...context.binding,
          command: {
            ...context.binding.command,
            task: { ...context.binding.command.task, runId: other.task.run_id }
          }
        }
        await h.sql`UPDATE hive_task_bindings SET binding=${h.sql.json(binding)} WHERE task_id=${context.task.id}`
      }
      const before = await h.snapshot(context)
      await expect(
        h.repository.resolveExternalExecution(context.task.company_id, context.task.run_id)
      ).rejects.toThrow()
      expect(await h.snapshot(context)).toEqual(before)
    }
  )

  it.each(['cancel', 'drain'])(
    'refuses stale scope in %s without committing an intent',
    async (action) => {
      const context = await h.newTask(),
        before = await h.snapshot(context)
      await expect(
        h.repository[action](context.accountId, context.task.id, {
          companyId: context.task.company_id,
          runId: randomUUID()
        })
      ).rejects.toThrow('FORBIDDEN')
      expect(await h.snapshot(context)).toEqual(before)
      const [run] =
        await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
      expect(run.context_snapshot?.externalExecutionControl).toBeUndefined()
    }
  )

  it.each(['cancel', 'drain'])(
    'rolls back %s when the final writer loses its persisted driver after a real lock wait',
    async (action) => {
      const context = await h.newTask()
      let pending
      await h.sql.begin(async (db) => {
        const [session] = await db`SELECT pg_backend_pid() AS pid`
        await db`SELECT id FROM heartbeat_runs WHERE id=${context.task.run_id} FOR UPDATE`
        pending = h.repository[action](context.accountId, context.task.id).then(
          () => null,
          (error) => error
        )
        await h.waitForLocks(session.pid, 1, '%UPDATE heartbeat_runs SET context_snapshot%')
        await db`UPDATE heartbeat_runs SET driver_kind='codex_local' WHERE id=${context.task.run_id}`
      })
      expect((await pending)?.code).toBe('REVISION_CONFLICT')
      const state = await h.snapshot(context)
      expect(state.task.cancel_requested).toBe(false)
      expect(state.task.result_receipt).toBeNull()
      expect(state.task.checkout_run_id).toBe(context.task.run_id)
      const [run] =
        await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
      expect(run.context_snapshot?.externalExecutionControl).toBeUndefined()
    }
  )
})
