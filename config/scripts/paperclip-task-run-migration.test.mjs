import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createTaskRunMigrationHarness,
  seedTaskRun,
  seedTaskDelivery,
  seedTaskClaim,
  seedTaskInbox,
  taskRunSnapshot
} from './paperclip-task-run-migration-fixture.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG

async function constraints(db) {
  return db`SELECT c.conrelid::regclass::text AS relation,c.conname,c.contype,
    pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
    WHERE n.nspname=current_schema() ORDER BY relation,c.conname`
}

async function completeHistory(db, row) {
  await seedTaskDelivery(db, row)
  await seedTaskClaim(db, row)
  await seedTaskInbox(db, row)
}

describe.skipIf(!configPath)('real PostgreSQL task run key migration', () => {
  let h
  beforeAll(async () => {
    h = await createTaskRunMigrationHarness(configPath)
  })
  afterAll(async () => {
    await h?.close()
  })

  it('retains all original rows and terminal facts across repeated migration and DDL loads', async () => {
    const fixture = await h.schema()
    const original = await fixture.within(async (db) => {
      const row = await seedTaskRun(db)
      await completeHistory(db, row)
      return { row, snapshot: await taskRunSnapshot(db) }
    })
    await expect(fixture.within((db) => seedTaskRun(db, original.row))).rejects.toMatchObject({
      code: '23505'
    })

    await fixture.migrate()
    const [upgradedIndex] = await fixture.within(
      (db) => db`SELECT indexrelid,
      pg_get_indexdef(indexrelid,1,true) AS first_key,pg_get_indexdef(indexrelid,2,true) AS cursor_key
      FROM pg_index WHERE indexrelid='hive_task_bindings_recovery_idx'::regclass`
    )
    expect(upgradedIndex).toMatchObject({ first_key: 'account_id', cursor_key: 'run_id' })
    await fixture.migrate()
    await fixture.within(async (db) => {
      await db.unsafe(fixture.ddl)
      await db.unsafe(fixture.ddl)
      const [sameIndex] = await db`SELECT indexrelid FROM pg_index
        WHERE indexrelid='hive_task_bindings_recovery_idx'::regclass`
      expect(sameIndex.indexrelid).toBe(upgradedIndex.indexrelid)
      expect(await taskRunSnapshot(db)).toEqual(original.snapshot)
      const definitions = await constraints(db)
      for (const relation of ['hive_task_bindings', 'hive_task_deliveries']) {
        expect(definitions.find((c) => c.relation === relation && c.contype === 'p')).toMatchObject(
          {
            definition: 'PRIMARY KEY (run_id)'
          }
        )
      }
      expect(
        definitions.some(
          (c) =>
            ['hive_task_bindings', 'hive_task_deliveries'].includes(c.relation) &&
            c.definition === 'FOREIGN KEY (account_id) REFERENCES hive_task_accounts(account_id)'
        )
      ).toBe(false)
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: 'hive_task_bindings',
            definition: 'FOREIGN KEY (task_id) REFERENCES issues(id)'
          }),
          expect.objectContaining({
            relation: 'hive_task_bindings',
            definition: 'FOREIGN KEY (run_id) REFERENCES heartbeat_runs(id)'
          }),
          expect.objectContaining({
            relation: 'hive_task_deliveries',
            definition:
              'FOREIGN KEY (task_id, account_id, run_id) REFERENCES hive_task_bindings(task_id, account_id, run_id)'
          }),
          expect.objectContaining({
            relation: 'hive_task_delivery_claim_receipts',
            definition: 'UNIQUE (run_id, generation)'
          })
        ])
      )
    })
  })

  it.each([false, true])(
    'keeps independent history for two runs of one Issue (new database=%s)',
    async (current) => {
      const fixture = await h.schema(current)
      const first = await fixture.within(async (db) => {
        const row = await seedTaskRun(db)
        await completeHistory(db, row)
        return row
      })
      await fixture.migrate()
      const second = await fixture.within(async (db) => {
        const row = await seedTaskRun(db, first, {
          accountId: `workbench:${randomUUID()}`
        })
        await completeHistory(db, row)
        return row
      })
      expect(second.taskId).toBe(first.taskId)
      expect(second.runId).not.toBe(first.runId)
      await fixture.migrate()
      await fixture.within(async (db) => {
        const snapshot = await taskRunSnapshot(db)
        expect(snapshot.hive_task_accounts).toHaveLength(1)
        for (const table of [
          'hive_task_bindings',
          'hive_task_deliveries',
          'hive_task_delivery_claim_receipts',
          'hive_task_event_inbox'
        ]) {
          expect(snapshot[table]).toHaveLength(2)
          expect(new Set(snapshot[table].map(({ row }) => row.run_id))).toEqual(
            new Set([first.runId, second.runId])
          )
        }
        expect(
          snapshot.hive_task_bindings.find(({ row }) => row.run_id === first.runId).row
            .result_receipt
        ).toEqual({ preserved: 'result', runId: first.runId })
        expect(
          snapshot.hive_task_bindings.find(({ row }) => row.run_id === second.runId).row
            .result_receipt
        ).toEqual({ preserved: 'result', runId: second.runId })
      })
      await expect(
        fixture.within((db) => seedTaskClaim(db, first, { lease_ref: `duplicate:${randomUUID()}` }))
      ).rejects.toMatchObject({ code: '23505' })
      await fixture.within((db) =>
        seedTaskClaim(db, first, { lease_ref: `next:${randomUUID()}`, generation: 2 })
      )
    }
  )

  it('rejects delivery, claim and event tuples from another account or run', async () => {
    const fixture = await h.schema(true)
    const first = await fixture.within(async (db) => {
      const row = await seedTaskRun(db)
      await completeHistory(db, row)
      return row
    })
    const second = await fixture.within((db) =>
      seedTaskRun(db, first, { accountId: `workbench:${randomUUID()}` })
    )
    await expect(
      fixture.within((db) => seedTaskDelivery(db, second, { account_id: first.accountId }))
    ).rejects.toMatchObject({ code: '23503' })
    await fixture.within((db) => seedTaskDelivery(db, second))
    await expect(
      fixture.within((db) => seedTaskClaim(db, second, { account_id: first.accountId }))
    ).rejects.toMatchObject({ code: '23503' })
    await expect(
      fixture.within((db) => seedTaskInbox(db, second, { run_id: first.runId }))
    ).rejects.toMatchObject({ code: '23503' })
    await expect(
      fixture.within((db) => seedTaskInbox(db, second, { execution_id: first.executionId }))
    ).rejects.toMatchObject({ code: '23503' })
    await fixture.within(async (db) => {
      await seedTaskClaim(db, second)
      await seedTaskInbox(db, second)
    })
  })

  it('retains protocol, epoch, fingerprint and terminal-state checks after migration', async () => {
    const fixture = await h.schema()
    const first = await fixture.within((db) => seedTaskRun(db))
    await fixture.migrate()
    const invalid = [
      { protocol_version: 2 },
      { ownership_epoch: 0 },
      { execution_epoch: '9007199254740992' },
      { command_fingerprint: 'not-a-digest' },
      { takeover_after: '2029-01-01T00:00:00Z' },
      { event_cursor: 3 },
      { accepted_hash: null },
      { terminal_sequence: null },
      { terminal_sequence: 3 }
    ]
    for (const changes of invalid) {
      await expect(
        fixture.within((db) => seedTaskDelivery(db, first, changes))
      ).rejects.toMatchObject({ code: '23514' })
    }
    await expect(
      fixture.within(
        (db) =>
          db`INSERT INTO hive_task_bindings
          (task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector)
          VALUES(${randomUUID()},'workbench:absent',${randomUUID()},'request:absent','input','folder:test')`
      )
    ).rejects.toMatchObject({ code: '23503' })
    await fixture.within((db) => completeHistory(db, first))
  })

  it('rolls back every constraint change when an old delivery has a mismatched run binding', async () => {
    const fixture = await h.schema()
    const original = await fixture.within(async (db) => {
      const first = await seedTaskRun(db)
      const other = await seedTaskRun(db)
      await seedTaskDelivery(db, first, { run_id: other.runId })
      return {
        snapshot: await taskRunSnapshot(db),
        constraints: await constraints(db)
      }
    })
    await expect(fixture.migrate()).rejects.toMatchObject({ code: '23503' })
    await fixture.within(async (db) => {
      expect(await taskRunSnapshot(db)).toEqual(original.snapshot)
      expect(await constraints(db)).toEqual(original.constraints)
    })
    await expect(fixture.migrate()).rejects.toMatchObject({ code: '23503' })
  })

  it('serializes concurrent migrations while preserving rows behind an existing writer lock', async () => {
    const fixture = await h.schema()
    const original = await fixture.within(async (db) => {
      const row = await seedTaskRun(db)
      await completeHistory(db, row)
      return taskRunSnapshot(db)
    })
    let release, signalReady, rejectReady
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const ready = new Promise((resolve, reject) => {
      signalReady = resolve
      rejectReady = reject
    })
    const blocker = fixture.within(async (db) => {
      const [session] = await db`SELECT pg_backend_pid() AS pid`
      await db`LOCK TABLE hive_task_bindings IN ACCESS EXCLUSIVE MODE`
      signalReady(session.pid)
      await gate
    })
    void blocker.catch(rejectReady)
    const pending = []
    try {
      const blockerPid = await ready
      pending.push(fixture.migrate(), fixture.migrate())
      for (const promise of pending) {
        void promise.catch(() => {})
      }
      await vi.waitFor(
        async () => {
          const waiting = await fixture.within(
            (db) =>
              db`SELECT pid,pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
              WHERE datname=current_database() AND application_name=current_setting('application_name')
                AND state='active'
                AND wait_event_type='Lock' AND query LIKE 'DO $migration$%'
                AND query LIKE '%hive.paperclip.task-run-key.v1%'`
          )
          expect(waiting).toHaveLength(2)
          expect(waiting.some((row) => row.blockers.includes(blockerPid))).toBe(true)
          expect(
            waiting.some((row) =>
              row.blockers.some((pid) => waiting.some((peer) => peer.pid === pid))
            )
          ).toBe(true)
        },
        { timeout: 5000, interval: 25 }
      )
    } finally {
      release()
      await Promise.all([blocker, ...pending])
    }
    await fixture.within(async (db) => {
      expect(await taskRunSnapshot(db)).toEqual(original)
      expect(
        (await constraints(db)).filter(
          (c) =>
            ['hive_task_bindings', 'hive_task_deliveries'].includes(c.relation) &&
            c.contype === 'p' &&
            c.definition === 'PRIMARY KEY (run_id)'
        )
      ).toHaveLength(2)
    })
  })
})
