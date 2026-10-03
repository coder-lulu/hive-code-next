import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { createTaskDispatch } from '../../integration/paperclip/service/task-dispatch.mjs'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

describe('Paperclip dispatch concurrency', () => {
  it('reserves a flight before awaiting the transactional dispatch claim', async () => {
    let release
    const claimDispatch = vi.fn(
      () =>
        new Promise((done) => {
          release = done
        })
    )
    const dispatch = createTaskDispatch({ claimDispatch })
    const first = dispatch.start('account', 'task'),
      second = dispatch.start('account', 'task')
    expect(claimDispatch).toHaveBeenCalledTimes(1)
    release({ result_receipt: { status: 'cancelled' } })
    await Promise.all([first, second])
    await dispatch.close()
    await expect(dispatch.start('account', 'task')).rejects.toThrow('SERVICE_UNAVAILABLE')
  })
})

describe.skipIf(!process.env.HIVE_PAPERCLIP_TEST_CONFIG)(
  'isolated real Paperclip PostgreSQL contract',
  () => {
    let sql, repository, descriptor
    const account = `p1-contract:${randomUUID()}`
    const foreign = `p1-contract:${randomUUID()}`
    beforeAll(async () => {
      const config = JSON.parse(
        await readFile(resolve(process.env.HIVE_PAPERCLIP_TEST_CONFIG), 'utf8')
      )
      const database = new URL(config.databaseUrl)
      if (
        !config.containerName.startsWith('hive-paperclip-p1-') ||
        database.hostname !== '127.0.0.1' ||
        database.pathname !== '/hive_tasks'
      ) {
        throw new Error('An isolated P1 database is required')
      }
      const requireDb = createRequire(
        resolve(
          process.env.HIVE_PAPERCLIP_SOURCE ?? 'logs/paperclip-p1/paperclip',
          'packages/db/package.json'
        )
      )
      sql = requireDb('postgres')(config.databaseUrl, { max: 4, onnotice: () => {} })
      repository = createTaskRepository(sql)
      descriptor = JSON.parse(await readFile(config.serviceDescriptor, 'utf8'))
    })
    afterAll(async () => {
      await sql?.end({ timeout: 5 })
    })
    const request = async (path, body, identity = account) => {
      const response = await fetch(`${descriptor.baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${descriptor.secret}`,
          'Content-Type': 'application/json',
          'X-Hive-Account-Id': identity
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      return { status: response.status, body: await response.json() }
    }
    const create = async () => {
      const input = {
        requestId: randomUUID(),
        title: 'P1 database contract',
        input: 'Produce report.md',
        workspaceSelector: 'folder:test'
      }
      const response = await request('/hive/tasks', input)
      expect(response.status).toBe(201)
      return { input, task: response.body }
    }
    const bindingFor = (task) => {
      const command = taskCommand({
        runtimeRecordId: 'runtime:p1-contract',
        ownershipEpoch: 1,
        profileId: 'codex',
        profileRevision: 'codex:1',
        executionId: `execution:${randomUUID()}`,
        task: {
          spaceId: task.company_id,
          taskId: task.id,
          runId: task.run_id,
          attempt: 1,
          taskRevision: String(task.status_version)
        },
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      })
      return {
        bindingRef: `binding:${randomUUID()}`,
        paperclipCompanyId: task.company_id,
        paperclipAgentId: task.agent_id,
        command,
        commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
      }
    }
    it('coalesces concurrent create requests and rejects changed input without another issue', async () => {
      const { input, task } = await create()
      const repeated = await Promise.all(
        Array.from({ length: 6 }, () => request('/hive/tasks', input))
      )
      expect(repeated.every((item) => item.status === 201 && item.body.id === task.id)).toBe(true)
      expect((await request('/hive/tasks', { ...input, title: 'Changed' })).body.error.code).toBe(
        'IDEMPOTENCY_CONFLICT'
      )
      const [count] =
        await sql`SELECT count(*)::int AS count FROM hive_task_bindings WHERE account_id=${account} AND request_id=${input.requestId}`
      expect(count.count).toBe(1)
    })
    it('denies cross-account reads and all non-Hive endpoints before DB side effects', async () => {
      const { task } = await create()
      const [before] = await sql`SELECT count(*)::int AS count FROM agents`
      expect((await request(`/hive/tasks/${task.id}`, undefined, foreign)).status).toBe(403)
      for (const path of [
        '/api/agents',
        '/api/companies/test/skills',
        '/api/skill-studio',
        '/api/agents/test/wakeup',
        '/api/secrets',
        '/api/plugins',
        '/api/companies/test/workspaces'
      ]) {
        expect(
          (await request(path, { adapterType: 'codex_local', command: 'must not run' })).status
        ).toBe(403)
      }
      expect(
        (
          await request('/hive/tasks', {
            requestId: randomUUID(),
            title: 'Invalid',
            input: 'x',
            workspaceSelector: 'x',
            model: 'forbidden'
          })
        ).status
      ).toBe(400)
      const [after] = await sql`SELECT count(*)::int AS count FROM agents`
      expect(after.count).toBe(before.count)
    })
    it('rejects other executors, team execution and resource snapshots before checkout', async () => {
      const { task } = await create(),
        binding = bindingFor(task)
      const commands = [
        { ...binding.command, profileId: 'native-pi' },
        { ...binding.command, ownerScope: { kind: 'teamSpace', teamSpaceRef: 'team:test' } },
        {
          ...binding.command,
          resourceSnapshotRef: 'snapshot:test',
          resourceSnapshotDigest: 'a'.repeat(64),
          manifestVersion: 'manifest:test',
          resolverVersion: 'resolver:test',
          requiredCoverage: 'managed_only',
          resourceScopeRef: 'scope:test'
        }
      ]
      for (const command of commands) {
        expect(
          (await request(`/hive/tasks/${task.id}/binding`, { ...binding, command })).status
        ).toBe(403)
      }
      const row = await repository.read(account, task.id)
      expect(row.binding).toBeNull()
      expect(row.checkout_run_id).toBeNull()
      expect(row.status).toBe('todo')
    })
    it('accepts only the current task binding and permits an expiry-only renewal replay', async () => {
      const { task } = await create(),
        binding = bindingFor(task)
      expect(
        (
          await request(`/hive/tasks/${task.id}/binding`, {
            ...binding,
            paperclipAgentId: randomUUID()
          })
        ).status
      ).toBe(409)
      expect((await request(`/hive/tasks/${task.id}/binding`, binding)).status).toBe(200)
      expect(
        (
          await request(`/hive/tasks/${task.id}/binding`, {
            ...binding,
            command: { ...binding.command, expiresAt: new Date(Date.now() + 120_000).toISOString() }
          })
        ).status
      ).toBe(200)
      const stored = await repository.read(account, task.id)
      expect(Number(stored.status_version)).toBe(1)
      expect(stored.checkout_run_id).toBe(task.run_id)
    })
    it('does not let a stale unknown observation overwrite a terminal run after a row-lock wait', async () => {
      const { task } = await create(),
        binding = bindingFor(task)
      await repository.bind(account, task.id, binding)
      await repository.claimDispatch(account, task.id)
      let marking = Promise.resolve()
      await sql.begin(async (db) => {
        await db`SELECT id FROM heartbeat_runs WHERE id=${task.run_id} FOR UPDATE`
        marking = repository.unknown(account, task.id)
        await vi.waitFor(
          async () => {
            const [waiting] = await sql`SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname='hive_tasks' AND wait_event_type='Lock' AND query LIKE ${"%execution_stage='outcome_unknown'%"}`
            expect(waiting.count).toBeGreaterThan(0)
          },
          { timeout: 5000, interval: 25 }
        )
        await db`UPDATE heartbeat_runs SET status='cancelled',execution_stage='settled' WHERE id=${task.run_id}`
      })
      await marking
      const [run] = await sql`SELECT execution_stage FROM heartbeat_runs WHERE id=${task.run_id}`
      expect(run.execution_stage).toBe('settled')
    })
    it('holds cancellation until a matching stop receipt and settles duplicates exactly once', async () => {
      const { task } = await create(),
        binding = bindingFor(task)
      await repository.bind(account, task.id, binding)
      await repository.claimDispatch(account, task.id)
      const cancelled = await repository.cancel(account, task.id)
      expect(cancelled.result_receipt).toBeNull()
      expect(cancelled.checkout_run_id).toBe(task.run_id)
      const command = binding.command,
        recordedAt = new Date().toISOString()
      const receipt = {
        protocolVersion: 1,
        kind: 'execution.result',
        runtimeRecordId: command.runtimeRecordId,
        ownershipEpoch: command.ownershipEpoch,
        executionId: command.executionId,
        executionEpoch: command.executionEpoch,
        commandFingerprint: binding.commandFingerprint,
        recordedAt,
        receiptId: 'receipt:p1-contract',
        status: 'cancelled',
        outcomeRef: 'outcome:p1-contract',
        artifactRefs: [],
        usageFactRefs: [],
        stopProof: {
          proofRef: 'proof:p1-contract',
          evidenceKind: 'stopped',
          managedToolsSettled: true,
          writersFenced: true,
          recordedAt
        }
      }
      await expect(
        repository.settle(account, task.id, { ...receipt, executionId: 'execution:foreign' })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      const settled = await Promise.all(
        Array.from({ length: 6 }, () => repository.settle(account, task.id, receipt))
      )
      expect(
        settled.every(
          (row) =>
            row.status === 'cancelled' &&
            row.checkout_run_id === null &&
            Number(row.status_version) === 2
        )
      ).toBe(true)
      await expect(
        repository.settle(account, task.id, { ...receipt, receiptId: 'receipt:other' })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      const [run] =
        await sql`SELECT status,execution_stage FROM heartbeat_runs WHERE id=${task.run_id}`
      expect(run).toEqual({ status: 'cancelled', execution_stage: 'settled' })
      const summary = (await request('/hive/tasks')).body.find((row) => row.id === task.id)
      expect(summary.binding).toBeUndefined()
      expect(Object.keys(summary.result_receipt).sort()).toEqual(['artifactRefs', 'status'])
    })
  }
)
