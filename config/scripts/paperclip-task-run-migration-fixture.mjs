import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'

const tableNames = [
  'hive_task_event_inbox',
  'hive_task_delivery_claim_receipts',
  'hive_task_deliveries',
  'hive_task_bindings',
  'hive_task_accounts',
  'heartbeat_runs',
  'issues',
  'agents',
  'companies'
]
const source = (name) =>
  readFile(new URL(`../../integration/paperclip/service/${name}.sql`, import.meta.url), 'utf8')

export async function createTaskRunMigrationHarness(configPath) {
  const harness = await createPostgresTaskHarness(configPath)
  const sql = harness.sql
  const schemas = new Map()
  const ddl = await source('task-tables')
  const migration = await source('task-run-migration')
  const before = await readFile(
    new URL('./fixtures/paperclip-task-tables-before-run-scope.sql', import.meta.url),
    'utf8'
  )
  async function schema(current = false) {
    const name = `task_run_fixture_${randomUUID().replaceAll('-', '')}`
    await sql`CREATE SCHEMA ${sql(name)}`
    const [created] = await sql`SELECT oid FROM pg_namespace WHERE nspname=${name}`
    schemas.set(name, created.oid)
    const within = (work) =>
      sql.begin(async (db) => {
        await db`SET LOCAL search_path TO ${db(name)}`
        return work(db)
      })
    await within(async (db) => {
      await db.unsafe(`
        CREATE TABLE companies(id uuid PRIMARY KEY, retained text NOT NULL DEFAULT 'company');
        CREATE TABLE agents(id uuid PRIMARY KEY, retained text NOT NULL DEFAULT 'agent');
        CREATE TABLE issues(id uuid PRIMARY KEY, retained text NOT NULL DEFAULT 'issue');
        CREATE TABLE heartbeat_runs(id uuid PRIMARY KEY, retained text NOT NULL DEFAULT 'run');`)
      await db.unsafe(current ? ddl : before)
    })
    return { name, within, migrate: () => within((db) => db.unsafe(migration)), ddl, migration }
  }
  async function close() {
    try {
      for (const [name, oid] of schemas) {
        const [current] = await sql`SELECT oid FROM pg_namespace WHERE nspname=${name}`
        if (current?.oid !== oid) {
          throw new Error('TASK_RUN_FIXTURE_SCHEMA_IDENTITY_CHANGED')
        }
        await sql.begin(async (db) => {
          await db`SET LOCAL search_path TO ${db(name)}`
          for (const table of tableNames) {
            await db`DROP TABLE IF EXISTS ${db(table)}`
          }
          await db`DROP SCHEMA ${db(name)}`
        })
      }
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
  return { schema, close }
}

export async function seedTaskRun(db, previous, overrides = {}) {
  const taskId = previous?.taskId ?? randomUUID()
  const runId = randomUUID()
  const accountId = previous?.accountId ?? `migration:${randomUUID()}`
  if (!previous) {
    const companyId = randomUUID()
    const agentId = randomUUID()
    await db`INSERT INTO companies(id) VALUES(${companyId})`
    await db`INSERT INTO agents(id) VALUES(${agentId})`
    await db`INSERT INTO issues(id) VALUES(${taskId})`
    await db`INSERT INTO hive_task_accounts(account_id,company_id,agent_id)
      VALUES(${accountId},${companyId},${agentId})`
  }
  const row = {
    taskId,
    runId,
    accountId,
    runtimeId: `runtime:${runId}`,
    executionId: `execution:${runId}`,
    leaseRef: `lease:${runId}`,
    fingerprint: 'a'.repeat(64),
    ...overrides
  }
  await db`INSERT INTO heartbeat_runs(id) VALUES(${runId})`
  await db`INSERT INTO hive_task_bindings
    (task_id,account_id,run_id,request_id,input_fingerprint,workspace_selector,binding,result_receipt,cancel_requested)
    VALUES(${row.taskId},${row.accountId},${runId},${`request:${runId}`},'input','folder:migration',
      ${db.json({ preserved: 'binding', runId })},${db.json({ preserved: 'result', runId })},true)`
  return row
}

export async function seedTaskDelivery(db, row, overrides = {}) {
  const values = {
    task_id: row.taskId,
    account_id: row.accountId,
    run_id: row.runId,
    protocol_version: 1,
    runtime_record_id: row.runtimeId,
    ownership_epoch: 1,
    execution_id: row.executionId,
    execution_epoch: 1,
    command_fingerprint: row.fingerprint,
    owner_id: 'owner:migration',
    lease_ref: row.leaseRef,
    generation: 1,
    claim_kind: 'delivery',
    lease_duration_ms: 30_000,
    expires_at: '2030-01-01T00:00:00Z',
    takeover_after: '2030-01-01T00:01:00Z',
    event_cursor: 1,
    last_sequence: 2,
    accepted_receipt: db.json({ preserved: 'accepted', runId: row.runId }),
    accepted_hash: row.fingerprint,
    terminal_sequence: 2,
    terminal_receipt: db.json({ preserved: 'terminal', runId: row.runId }),
    terminal_hash: row.fingerprint,
    ...overrides
  }
  await db`INSERT INTO hive_task_deliveries ${db(values)}`
}

export async function seedTaskClaim(db, row, overrides = {}) {
  await db`INSERT INTO hive_task_delivery_claim_receipts ${db({
    lease_ref: row.leaseRef,
    account_id: row.accountId,
    task_id: row.taskId,
    run_id: row.runId,
    generation: 1,
    request_hash: row.fingerprint,
    receipt_hash: row.fingerprint,
    receipt: db.json({ preserved: 'claim', runId: row.runId }),
    ...overrides
  })}`
}

export async function seedTaskInbox(db, row, overrides = {}) {
  await db`INSERT INTO hive_task_event_inbox ${db({
    task_id: row.taskId,
    account_id: row.accountId,
    run_id: row.runId,
    runtime_record_id: row.runtimeId,
    ownership_epoch: 1,
    execution_id: row.executionId,
    execution_epoch: 1,
    command_fingerprint: row.fingerprint,
    sequence: 2,
    payload_hash: row.fingerprint,
    payload: db.json({ preserved: 'event', runId: row.runId }),
    ...overrides
  })}`
}

export async function taskRunSnapshot(db) {
  const snapshot = {}
  for (const table of tableNames) {
    snapshot[table] = await db`SELECT row_to_json(t) AS row FROM ${db(table)} t
      ORDER BY row_to_json(t)::text`
  }
  return snapshot
}
