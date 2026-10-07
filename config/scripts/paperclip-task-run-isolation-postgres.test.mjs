import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
describe.skipIf(!configPath)('real PostgreSQL repeated Issue run isolation', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.close()
  })

  // Seed upstream admission facts directly; this suite qualifies the original execution repository,
  // not workflow admission, a scheduler or real provider execution.
  async function secondRun(first, installCheckout = false) {
    const runId = randomUUID()
    const current = await h.repository.read(first.accountId, first.task.id, first.task.run_id)
    const command = {
      ...first.command,
      executionId: `execution:${runId}`,
      operationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
      workspaceExecutionClaimRef: `claim:${runId}`,
      task: {
        ...first.command.task,
        runId,
        attempt: 2,
        taskRevision: String(current.status_version)
      }
    }
    const binding = {
      ...first.binding,
      bindingRef: `binding:${runId}`,
      command,
      commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
    }
    await h.sql.begin(async (db) => {
      await db`SELECT id FROM issues WHERE id=${first.task.id} FOR UPDATE`
      await db`INSERT INTO heartbeat_runs(id,company_id,agent_id,status,invocation_source,driver_kind)
        VALUES(${runId},${first.task.company_id},${first.task.agent_id},'queued','on_demand','hive_runtime')`
      await db`INSERT INTO hive_task_bindings(task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector,binding)
        VALUES(${first.task.id},${first.accountId},${runId},${randomUUID()},'seeded-admission',${first.task.workspace_selector},${db.json(binding)})`
      if (installCheckout) {
        await db`UPDATE issues SET checkout_run_id=${runId},execution_run_id=${runId},status='in_progress',
          status_version=status_version+1 WHERE id=${first.task.id}`
      }
    })
    return {
      ...first,
      command,
      binding,
      task: await h.repository.read(first.accountId, first.task.id, runId)
    }
  }
  async function claimed(context) {
    const input = h.claimInput()
    const proof = await h.repository.claimDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      input
    )
    return { proof, token: h.token(proof) }
  }

  it('preserves the first result and inbox while a second run starts its own delivery generation', async () => {
    const first = await h.newTask()
    const a = await claimed(first)
    await h.repository.claimDispatch(first.accountId, first.task.id, first.task.run_id, a.token)
    const events = [first.event(1, 'accepted'), first.event(2, 'succeeded')]
    await h.repository.consumeObservation(
      first.accountId,
      first.task.id,
      first.task.run_id,
      a.token,
      first.observation(events, first.result)
    )
    const oldState = await h.snapshot(first)
    const second = await secondRun(first, true)
    const b = await claimed(second)
    expect(a.proof.generation).toBe(1)
    expect(b.proof.generation).toBe(1)
    expect(b.proof.runId).toBe(second.task.run_id)
    const before = await h.snapshot(second)
    await h.repository.cancel(first.accountId, first.task.id, first.task.run_id)
    await h.repository.drain(first.accountId, first.task.id, first.task.run_id)
    await h.repository.unknown(first.accountId, first.task.id, first.task.run_id, a.token)
    await h.repository.releaseDelivery(first.accountId, first.task.id, first.task.run_id, a.token)
    await expect(
      h.repository.renewDelivery(first.accountId, first.task.id, first.task.run_id, {
        ...a.token,
        leaseMs: 1000
      })
    ).rejects.toThrow('REVISION_CONFLICT')
    const replay = await h.repository.settle(
      first.accountId,
      first.task.id,
      first.task.run_id,
      first.result
    )
    expect(replay.result_receipt).toEqual(first.result)
    expect(await h.snapshot(second)).toEqual(before)
    const after = await h.snapshot(first)
    expect(after.inbox).toBe(oldState.inbox)
    expect(after.claims).toBe(oldState.claims)
    expect(after.task.result_receipt).toEqual(oldState.task.result_receipt)
    expect(after.run).toEqual(oldState.run)
    expect((await h.repository.list(first.accountId)).map((row) => row.run_id).sort()).toEqual(
      [first.task.run_id, second.task.run_id].sort()
    )
    await expect(h.repository.read(first.accountId, first.task.id, randomUUID())).rejects.toThrow(
      'FORBIDDEN'
    )
  })

  it('does not let a late uncommitted result clear another run checkout', async () => {
    const first = await h.newTask()
    const second = await secondRun(first, true)
    const before = await h.snapshot(second)
    await expect(
      h.repository.settle(first.accountId, first.task.id, first.task.run_id, first.result)
    ).rejects.toThrow('REVISION_CONFLICT')
    await expect(
      h.repository.claimDispatch(first.accountId, first.task.id, first.task.run_id)
    ).rejects.toThrow('REVISION_CONFLICT')
    expect(await h.snapshot(second)).toEqual(before)
    expect((await h.snapshot(first)).task.result_receipt).toBeNull()
  })

  it('paginates every unresolved run of the same Issue using the run cursor', async () => {
    const first = await h.newTask()
    const second = await secondRun(first)
    const page = await h.repository.listRecoverableRuns(first.accountId, { limit: 1 })
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe(page.items[0].run_id)
    const next = await h.repository.listRecoverableRuns(first.accountId, {
      limit: 1,
      after: page.nextCursor
    })
    expect(next.items).toHaveLength(1)
    expect(next.nextCursor).toBeNull()
    expect([...page.items, ...next.items].map((row) => row.run_id).sort()).toEqual(
      [first.task.run_id, second.task.run_id].sort()
    )
    expect(page.items[0].id).toBe(next.items[0].id)
  })

  it.each(['unknown', 'drain', 'cancel', 'settle'])(
    'refuses changed heartbeat identity after the %s writer waits for its row lock',
    async (action) => {
      const first = await h.newTask()
      await h.repository.claimDispatch(first.accountId, first.task.id, first.task.run_id)
      const otherAgent = randomUUID()
      await h.sql`INSERT INTO agents(id,company_id,name,adapter_type,adapter_config)
        VALUES(${otherAgent},${first.task.company_id},'Synthetic scope mutation','hive_runtime','{}'::jsonb)`
      let pending
      await h.sql.begin(async (db) => {
        const [session] = await db`SELECT pg_backend_pid() AS pid`
        await db`SELECT id FROM heartbeat_runs WHERE id=${first.task.run_id} FOR UPDATE`
        pending = h.repository[action](
          first.accountId,
          first.task.id,
          first.task.run_id,
          action === 'settle' ? first.result : undefined
        ).then(
          (value) => ({ status: 'fulfilled', value }),
          (reason) => ({ status: 'rejected', reason })
        )
        await h.waitForLocks(session.pid, 1, '%JOIN heartbeat_runs h%FOR SHARE OF i,b,h%')
        await (action === 'unknown'
          ? db`UPDATE heartbeat_runs SET driver_kind='codex_local' WHERE id=${first.task.run_id}`
          : db`UPDATE heartbeat_runs SET agent_id=${otherAgent} WHERE id=${first.task.run_id}`)
      })
      expect(await pending).toMatchObject({ status: 'rejected' })
      const [state] =
        await h.sql`SELECT i.status,i.checkout_run_id,i.execution_run_id,b.result_receipt,
        b.cancel_requested,r.status AS run_status,r.execution_stage,r.finished_at,r.context_snapshot
        FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id JOIN heartbeat_runs r ON r.id=b.run_id
        WHERE b.account_id=${first.accountId} AND b.run_id=${first.task.run_id}`
      expect(state).toMatchObject({
        status: 'in_progress',
        checkout_run_id: first.task.run_id,
        execution_run_id: first.task.run_id,
        result_receipt: null,
        cancel_requested: false,
        run_status: 'running',
        execution_stage: 'hive_dispatch',
        finished_at: null
      })
      expect(state.context_snapshot?.externalExecutionControl).toBeUndefined()
      await expect(
        h.repository.getCurrentDelivery(first.accountId, first.task.company_id, first.task.run_id)
      ).rejects.toThrow('FORBIDDEN')
    }
  )
})
