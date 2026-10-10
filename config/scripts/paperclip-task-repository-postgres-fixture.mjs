import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { expect, vi } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { runProcess } from '../../src/shared/child-process/run-process.ts'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

const containerName = 'hive-paperclip-p1-p2-validation-d2861510ba'
const containerId = '92c0b32b21d29eee62335174548c4e081b2c5884e481d230d85d5341aee28783'
const evidenceDirectory = resolve('logs/paperclip-development/p2/gateway-postgres')

async function validatedConfig(configPath) {
  let config, database
  try {
    if (resolve(configPath) !== resolve('logs/paperclip-development/storage/config.json')) {
      throw new Error('Unsupported dedicated PostgreSQL configuration path')
    }
    config = JSON.parse(await readFile(configPath, 'utf8'))
    database = new URL(config.databaseUrl)
    if (
      config.containerName !== containerName ||
      database.hostname !== '127.0.0.1' ||
      database.pathname !== '/hive_tasks' ||
      !['postgres:', 'postgresql:'].includes(database.protocol)
    ) {
      throw new Error('Unsupported dedicated PostgreSQL connection scope')
    }
  } catch {
    throw new Error('Dedicated P2 PostgreSQL configuration validation failed; credentials withheld')
  }
  const inspection = await runProcess({
    program: process.env.HIVE_PAPERCLIP_P2_DOCKER,
    args: [
      'inspect',
      '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}',
      containerName
    ],
    timeoutMs: 10_000,
    maxOutputBytes: 4096
  })
  if (inspection.code !== 0 || inspection.timedOut) {
    throw new Error('Dedicated P2 PostgreSQL container inspection failed')
  }
  const inspected = JSON.parse(inspection.stdout)
  const matchesPort = inspected.ports['5432/tcp']?.some(
    (port) =>
      Number(port.HostPort) === Number(database.port || 5432) &&
      ['127.0.0.1', '0.0.0.0', '::'].includes(port.HostIp)
  )
  if (
    inspected.id !== containerId ||
    inspected.name !== `/${containerName}` ||
    inspected.running !== true ||
    !matchesPort
  ) {
    throw new Error('Dedicated P2 PostgreSQL container identity or port mismatch')
  }
  return config
}

export async function createPostgresTaskHarness(configPath) {
  const config = await validatedConfig(configPath)
  const applicationName = `hive:p2-pg:${randomUUID()}`
  const requireDb = createRequire(process.env.HIVE_PAPERCLIP_P2_DB_PACKAGE)
  const sql = requireDb('postgres')(config.databaseUrl, {
    max: 12,
    connect_timeout: 5,
    onnotice: () => {},
    connection: {
      application_name: applicationName,
      statement_timeout: 12_000,
      idle_in_transaction_session_timeout: 15_000
    }
  })
  const repository = createTaskRepository(sql)
  const evidence = {
    containerVerified: true,
    loopbackDatabaseVerified: true,
    applicationName,
    locks: []
  }
  try {
    const [database] = await sql`SELECT current_database()='hive_tasks' AS allowed,
      current_setting('server_version_num')::integer AS version`
    if (!database.allowed) {
      throw new Error('Connected PostgreSQL database is outside the authorized scope')
    }
    evidence.postgresVersion = database.version
    await sql.unsafe(
      await readFile(
        new URL('../../integration/paperclip/service/task-tables.sql', import.meta.url),
        'utf8'
      )
    )
    for (const file of [
      'team-workbench-tables.sql',
      'workflow-definition-tables.sql',
      'workflow-case-tables.sql',
      'workflow-plan-intent-tables.sql',
      'workflow-plan-application-tables.sql',
      'workflow-plan-graph-tables.sql'
    ]) {
      await sql.unsafe(
        await readFile(
          new URL(`../../integration/paperclip/service/${file}`, import.meta.url),
          'utf8'
        )
      )
    }
    await sql.unsafe(
      await readFile(
        new URL('../../integration/paperclip/service/task-run-migration.sql', import.meta.url),
        'utf8'
      )
    )
  } catch (error) {
    await sql.end({ timeout: 5 })
    throw error
  }
  async function newTask() {
    const suffix = randomUUID()
    const accountId = `p2-postgres:${suffix}`
    const created = await repository.create(accountId, {
      requestId: randomUUID(),
      title: 'Synthetic P2 PostgreSQL regression',
      input: 'Database contract only; no execution host is launched',
      workspaceSelector: `folder:p2-pg:${suffix}`
    })
    const command = taskCommand({
      runtimeRecordId: `runtime:p2-pg:${suffix}`,
      executionId: `execution:p2-pg:${suffix}`,
      profileId: 'codex',
      profileRevision: 'codex:1',
      operationId: `${Date.now()}-${randomUUID().replaceAll('-', '')}`,
      ownerScope: { kind: 'personalTenant', tenantRef: `account:${digest(accountId)}` },
      workspaceExecutionClaimRef: `claim:p2-pg:${suffix}`,
      task: {
        spaceId: created.company_id,
        taskId: created.id,
        runId: created.run_id,
        attempt: 1,
        taskRevision: String(created.status_version)
      }
    })
    const binding = {
      bindingRef: `binding:p2-pg:${suffix}`,
      paperclipCompanyId: created.company_id,
      paperclipAgentId: created.agent_id,
      command,
      commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
    }
    const task = await repository.bind(accountId, created.id, created.run_id, binding)
    const identity = Object.fromEntries(
      ['protocolVersion', 'runtimeRecordId', 'ownershipEpoch', 'executionId', 'executionEpoch'].map(
        (key) => [key, command[key]]
      )
    )
    identity.commandFingerprint = binding.commandFingerprint
    const recordedAt = new Date().toISOString()
    const accepted = {
      ...identity,
      kind: 'execution.accepted',
      receiptId: `accepted:p2-pg:${suffix}`,
      recordedAt,
      status: 'accepted',
      operationId: command.operationId,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence
    }
    const result = {
      ...identity,
      kind: 'execution.result',
      receiptId: `result:p2-pg:${suffix}`,
      recordedAt,
      status: 'succeeded',
      outcomeRef: `outcome:p2-pg:${suffix}`,
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: {
        proofRef: `stop:p2-pg:${suffix}`,
        evidenceKind: 'stopped',
        managedToolsSettled: true,
        writersFenced: true,
        recordedAt
      }
    }
    return {
      accountId,
      task,
      command,
      binding,
      accepted,
      result,
      event: (sequence, status, changes = {}) => ({
        ...identity,
        kind: 'execution.event',
        eventId: `event:p2-pg:${suffix}:${sequence}`,
        recordedAt,
        sequence,
        status,
        artifactRefs: [],
        ...changes
      }),
      observation: (events, receipt = null, changes = {}) => ({
        ...identity,
        kind: 'execution.observation',
        accepted,
        events,
        cursor: events.at(-1)?.sequence ?? 0,
        lastSequence: events.at(-1)?.sequence ?? 1,
        status: receipt?.status ?? events.at(-1)?.status ?? 'running',
        sessionRef: `session:p2-pg:${suffix}`,
        result: receipt,
        ...changes
      })
    }
  }
  async function snapshot(context) {
    // Administrative fixture inspection does not confer service permission on corrupted rows.
    const [task] = await sql`SELECT i.*,b.run_id,b.binding,b.result_receipt,
      (b.cancel_requested OR h.context_snapshot->'externalExecutionControl'->'cancel' IS NOT NULL) AS cancel_requested,
      h.agent_id,h.execution_stage,h.driver_kind,h.status AS run_status
      FROM issues i JOIN hive_task_bindings b ON b.task_id=i.id JOIN heartbeat_runs h ON h.id=b.run_id
      WHERE b.account_id=${context.accountId} AND i.id=${context.task.id} AND b.run_id=${context.task.run_id}`
    const [delivery] = await sql`SELECT *,expires_at<=clock_timestamp() AS expired,
      takeover_after<=clock_timestamp() AS takeover_expired FROM hive_task_deliveries
      WHERE account_id=${context.accountId} AND task_id=${context.task.id} AND run_id=${context.task.run_id}`
    const [inbox] = await sql`SELECT count(*)::integer AS count FROM hive_task_event_inbox
      WHERE account_id=${context.accountId} AND task_id=${context.task.id} AND run_id=${context.task.run_id}`
    const [claims] =
      await sql`SELECT count(*)::integer AS count FROM hive_task_delivery_claim_receipts
      WHERE account_id=${context.accountId} AND task_id=${context.task.id} AND run_id=${context.task.run_id}`
    const [run] =
      await sql`SELECT status,execution_stage,result_json,finished_at,error_code FROM heartbeat_runs WHERE id=${context.task.run_id}`
    return { task, delivery, inbox: inbox.count, claims: claims.count, run }
  }
  async function waitForExpiry(deadline) {
    await vi.waitFor(
      async () => {
        const [clock] =
          await sql`SELECT clock_timestamp()>=${deadline}::timestamptz+interval '5 milliseconds' AS expired`
        expect(clock.expired).toBe(true)
      },
      { timeout: 7000, interval: 25 }
    )
  }
  async function waitForLocks(blockerPid, minimum = 1, queryPattern = '%') {
    await vi.waitFor(
      async () => {
        const locks =
          await sql`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE ${queryPattern}`
        expect(locks.length).toBeGreaterThanOrEqual(minimum)
        expect(locks.some((lock) => lock.blockers.includes(blockerPid))).toBe(true)
        evidence.locks.push({ blockerPid, minimum, queryPattern, locks })
      },
      { timeout: 5000, interval: 25 }
    )
  }
  async function withRowLock(context, table, work) {
    let release, signalReady, rejectReady
    const gate = new Promise((resolveGate) => {
      release = resolveGate
    })
    const ready = new Promise((resolveReady, reject) => {
      signalReady = resolveReady
      rejectReady = reject
    })
    const blocker = sql.begin(async (db) => {
      const [session] = await db`SELECT pg_backend_pid() AS pid`
      await (table === 'heartbeat_runs'
        ? db`SELECT id FROM heartbeat_runs WHERE id=${context.task.run_id} FOR UPDATE`
        : db`SELECT id FROM issues WHERE id=${context.task.id} FOR UPDATE`)
      signalReady(session.pid)
      await gate
    })
    void blocker.catch(rejectReady)
    try {
      return await work(await ready)
    } finally {
      release()
      await blocker
    }
  }
  return {
    sql,
    repository,
    evidence,
    newTask,
    snapshot,
    waitForExpiry,
    waitForLocks,
    withRowLock,
    claimInput: (expectedGeneration = 0, leaseMs = 30_000) => ({
      ownerId: `gateway:p2-pg:${randomUUID()}`,
      leaseRef: `delivery:p2-pg:${randomUUID()}`,
      expectedGeneration,
      leaseMs
    }),
    token: (proof) => ({
      ownerId: proof.ownerId,
      leaseRef: proof.leaseRef,
      generation: proof.generation
    }),
    close: async () => {
      await mkdir(evidenceDirectory, { recursive: true })
      await writeFile(
        resolve(evidenceDirectory, 'database-evidence.json'),
        JSON.stringify(evidence, null, 2)
      )
      await sql.end({ timeout: 5 })
    }
  }
}
