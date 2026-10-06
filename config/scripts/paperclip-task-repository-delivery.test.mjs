import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

const accountId = 'account:delivery-tests'
const companyId = randomUUID(),
  agentId = randomUUID(),
  taskId = randomUUID(),
  runId = randomUUID()
const command = taskCommand({
  profileId: 'codex',
  profileRevision: 'codex:1',
  task: { spaceId: companyId, taskId, runId, attempt: 1, taskRevision: '0' }
})
const binding = {
  bindingRef: 'binding:delivery-tests',
  paperclipCompanyId: companyId,
  paperclipAgentId: agentId,
  command,
  commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
}
const task = {
  id: taskId,
  account_id: accountId,
  case_id: null,
  run_company_id: companyId,
  agent_company_id: companyId,
  personal_company_id: companyId,
  personal_agent_id: agentId,
  driver_kind: 'hive_runtime',
  company_id: companyId,
  agent_id: agentId,
  run_id: runId,
  binding,
  result_receipt: null,
  status_version: 1,
  checkout_run_id: runId,
  run_status: 'running',
  cancel_requested: false,
  run_scope: {
    kind: 'personal',
    accountId,
    companyId,
    employeeRef: agentId,
    workspaceSelector: undefined
  }
}
const initial = {
  ownerId: 'gateway:first',
  leaseRef: 'delivery:first',
  expectedGeneration: 0,
  leaseMs: 30_000
}
const token = { ownerId: initial.ownerId, leaseRef: initial.leaseRef, generation: 1 }
const row = (changes = {}) => ({
  task_id: taskId,
  account_id: accountId,
  run_id: runId,
  protocol_version: 1,
  runtime_record_id: command.runtimeRecordId,
  ownership_epoch: command.ownershipEpoch,
  execution_id: command.executionId,
  execution_epoch: command.executionEpoch,
  command_fingerprint: binding.commandFingerprint,
  owner_id: initial.ownerId,
  lease_ref: initial.leaseRef,
  generation: '1',
  claim_kind: 'delivery',
  lease_duration_ms: 30_000,
  event_cursor: '0',
  last_sequence: '0',
  expires_at: new Date('2026-10-04T00:00:30.000Z'),
  server_now: new Date('2026-10-04T00:00:00.000Z'),
  takeover_after: new Date('2026-10-04T00:00:30.000Z'),
  accepted_receipt: null,
  accepted_hash: null,
  terminal_sequence: null,
  terminal_receipt: null,
  terminal_hash: null,
  ...changes
})

const receipt = (changes = {}) => ({
  accountId,
  companyId,
  taskId,
  runId,
  ...token,
  cursor: 0,
  protocolVersion: 1,
  runtimeRecordId: command.runtimeRecordId,
  ownershipEpoch: command.ownershipEpoch,
  executionId: command.executionId,
  executionEpoch: command.executionEpoch,
  commandFingerprint: binding.commandFingerprint,
  operationId: command.operationId,
  workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
  writeFence: command.writeFence,
  serverNow: '2026-10-04T00:00:00.000Z',
  expiresAt: '2026-10-04T00:00:30.000Z',
  ...changes
})
const claimHistory = (input = initial, original = receipt(), changes = {}) => ({
  request_hash: digest({
    accountId,
    taskId,
    runId,
    commandFingerprint: binding.commandFingerprint,
    kind: 'commandFingerprint' in input ? 'recovery' : 'delivery',
    input
  }),
  receipt_hash: digest(original),
  receipt: original,
  server_now: new Date('2026-10-04T00:05:00.000Z'),
  ...changes
})

function fixture(replies = []) {
  const calls = [],
    transactions = []
  const db = vi.fn(async (strings, ...values) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim()
    calls.push({ text, values })
    if (text.startsWith('SELECT b.account_id,b.task_id')) {
      expect(values).toEqual([companyId, runId])
      if (replies[0]?.length === 0) {
        return replies.shift()
      }
      return [{ account_id: accountId, task_id: taskId }]
    }
    if (text.startsWith('SELECT r.case_id,cb.project_id')) {
      expect(values).toEqual([accountId, taskId, runId])
      return [{ case_id: null }]
    }
    if (text.startsWith('SELECT i.id FROM issues i')) {
      expect(values).toEqual([accountId, taskId, runId])
      return [{ id: taskId }]
    }
    if (!replies.length) {
      throw new Error(`Unexpected SQL: ${text}`)
    }
    const reply = replies.shift()
    return typeof reply === 'function' ? reply({ text, values }) : reply
  })
  db.json = (value) => value
  const tx = Object.assign((strings, ...values) => db(strings, ...values), { json: db.json })
  db.begin = vi.fn(async (run) => {
    transactions.push('begin')
    try {
      const result = await run(tx)
      transactions.push('commit')
      return result
    } catch (error) {
      transactions.push('rollback')
      throw error
    }
  })
  return {
    sql: db,
    calls,
    transactions,
    repository: createTaskRepository(db),
    writes: () =>
      calls.filter(
        (call) =>
          /^(INSERT|UPDATE|DELETE)\b/.test(call.text) || call.text.startsWith('WITH lease_clock ')
      ),
    remaining: () => replies.length
  }
}

describe('durable task delivery ownership', () => {
  it('claims one bound execution using DB time without changing Paperclip execution state', async () => {
    const f = fixture([[task], [], [], [row()], []])
    const result = await f.repository.claimDelivery(accountId, taskId, runId, initial)
    expect(result).toMatchObject({
      accountId,
      companyId,
      taskId,
      runId,
      ...token,
      cursor: 0,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      commandFingerprint: binding.commandFingerprint,
      operationId: command.operationId,
      workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
      writeFence: command.writeFence,
      serverNow: '2026-10-04T00:00:00.000Z',
      expiresAt: '2026-10-04T00:00:30.000Z'
    })
    expect(f.transactions).toEqual(['begin', 'commit'])
    expect(f.calls.some((call) => call.text.includes('FOR UPDATE OF i,b'))).toBe(true)
    expect(f.writes()).toHaveLength(2)
    expect(f.writes()[0].text).toContain('INSERT INTO hive_task_deliveries')
    expect(f.writes()[0].text).toContain("lease_clock.server_now+?*interval '1 millisecond'")
    expect(f.writes()[1].text).toMatch(/^INSERT INTO hive_task_delivery_claim_receipts/)
    expect(f.writes()[1].values).toContainEqual(receipt())
    expect(f.remaining()).toBe(0)
  })

  it.each([0, 999, 60_001, 30_000.5, Number.NaN])(
    'rejects unbounded lease duration %s before SQL',
    async (leaseMs) => {
      const f = fixture()
      await expect(
        f.repository.claimDelivery(accountId, taskId, runId, { ...initial, leaseMs })
      ).rejects.toThrow()
      expect(f.calls).toHaveLength(0)
    }
  )

  it('does not accept an input flag as a Runtime revocation proof', async () => {
    const f = fixture()
    await expect(
      f.repository.claimDelivery(accountId, taskId, runId, { ...initial, hostProof: true })
    ).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })

  it('replays an expired claim without extending or reactivating the same lease reference', async () => {
    const f = fixture([[task], [claimHistory()]])
    const result = await f.repository.claimDelivery(accountId, taskId, runId, initial)
    expect(result.generation).toBe(1)
    expect(result.expiresAt).toBe('2026-10-04T00:00:30.000Z')
    expect(result.serverNow).toBe('2026-10-04T00:05:00.000Z')
    expect(f.writes()).toHaveLength(0)
  })

  it.each([{ ownerId: 'gateway:other' }, { expectedGeneration: 1 }, { leaseMs: 20_000 }])(
    'rejects changed claim content under the same lease reference: %s',
    async (change) => {
      const f = fixture([[task], [claimHistory()]])
      await expect(
        f.repository.claimDelivery(accountId, taskId, runId, { ...initial, ...change })
      ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
      expect(f.writes()).toHaveLength(0)
    }
  )

  it('replays the original generation after a newer owner took over without consulting the live lease', async () => {
    const f = fixture([[task], [claimHistory()]])
    expect(await f.repository.claimDelivery(accountId, taskId, runId, initial)).toMatchObject({
      generation: 1,
      leaseRef: initial.leaseRef,
      expiresAt: receipt().expiresAt,
      serverNow: '2026-10-04T00:05:00.000Z'
    })
    expect(
      f.calls.filter((call) => call.text.includes('FROM hive_task_delivery_claim_receipts'))
    ).toHaveLength(1)
    expect(f.calls.some((call) => call.text.includes('FROM hive_task_deliveries'))).toBe(false)
    expect(f.writes()).toHaveLength(0)
  })

  it('does not reconstruct a missing claim receipt for the same live lease reference', async () => {
    const f = fixture([[task], [], [row()]])
    await expect(f.repository.claimDelivery(accountId, taskId, runId, initial)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects a corrupted immutable receipt rather than returning an unverified proof', async () => {
    const f = fixture([
      [task],
      [claimHistory(initial, receipt(), { receipt_hash: 'f'.repeat(64) })]
    ])
    await expect(f.repository.claimDelivery(accountId, taskId, runId, initial)).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('requires expiry and an exact generation for an ordinary takeover', async () => {
    const next = {
      ownerId: 'gateway:next',
      leaseRef: 'delivery:next',
      expectedGeneration: 1,
      leaseMs: 30_000
    }
    const f = fixture([[task], [], [row()], []])
    await expect(f.repository.claimDelivery(accountId, taskId, runId, next)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    const update = f.writes()[0]
    expect(update.text).toContain('generation=generation+1')
    expect(update.text).toContain(
      'generation=? AND lease_ref=? AND expires_at<=lease_clock.server_now AND takeover_after<=lease_clock.server_now'
    )
    expect(update.values).toContain(initial.leaseRef)
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('transfers an expired delivery while preserving its inbox cursor and pending cancellation', async () => {
    const next = {
      ownerId: 'gateway:next',
      leaseRef: 'delivery:next',
      expectedGeneration: 1,
      leaseMs: 30_000
    }
    const expired = row({
      event_cursor: '7',
      last_sequence: '7',
      server_now: new Date('2026-10-04T00:05:00.000Z')
    })
    const transferred = row({
      owner_id: next.ownerId,
      lease_ref: next.leaseRef,
      generation: '2',
      event_cursor: '7',
      last_sequence: '7'
    })
    const f = fixture([[{ ...task, cancel_requested: true }], [], [expired], [transferred], []])
    expect(await f.repository.claimDelivery(accountId, taskId, runId, next)).toMatchObject({
      ownerId: next.ownerId,
      generation: 2,
      cursor: 7
    })
    expect(f.writes()).toHaveLength(2)
    expect(
      f.writes().every((call) => !/\b(issues|heartbeat_runs|hive_task_bindings)\b/.test(call.text))
    ).toBe(true)
    expect(f.writes()[0].text).not.toContain('event_cursor=')
    expect(f.writes()[0].text).not.toContain('cancel_requested=')
  })

  it('rejects a stale expected generation before attempting a takeover', async () => {
    const f = fixture([[task], [], [row({ generation: '3' })]])
    await expect(
      f.repository.claimDelivery(accountId, taskId, runId, {
        ...initial,
        leaseRef: 'delivery:new',
        expectedGeneration: 1
      })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.writes()).toHaveLength(0)
  })

  it('offers an internal recovery CAS for the caller that already revoked Runtime start authority', async () => {
    const input = {
      ownerId: 'gateway:recovery',
      leaseRef: 'delivery:recovery',
      expectedGeneration: 1,
      leaseMs: 30_000,
      commandFingerprint: binding.commandFingerprint
    }
    const recovered = row({
      owner_id: input.ownerId,
      lease_ref: input.leaseRef,
      generation: '2',
      claim_kind: 'recovery'
    })
    const f = fixture([[task], [], [row()], [recovered], []])
    expect(await f.repository.claimRecoveryDelivery(accountId, taskId, runId, input)).toMatchObject(
      {
        generation: 2,
        leaseRef: input.leaseRef
      }
    )
    expect(f.writes()[0].text).toContain('generation=? AND lease_ref=? AND command_fingerprint=?')
    expect(f.writes()[0].values).toContain(binding.commandFingerprint)
    expect(f.writes()[0].text).not.toContain('expires_at<=')
  })

  it('rejects a recovery handshake for another execution fingerprint', async () => {
    const f = fixture([[task]])
    await expect(
      f.repository.claimRecoveryDelivery(accountId, taskId, runId, {
        ...initial,
        commandFingerprint: 'f'.repeat(64)
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('renews only an unexpired matching owner, generation and lease reference', async () => {
    const f = fixture([[task], [row({ expires_at: new Date('2026-10-04T00:01:00.000Z') })]])
    expect(
      (await f.repository.renewDelivery(accountId, taskId, runId, { ...token, leaseMs: 30_000 }))
        .expiresAt
    ).toBe('2026-10-04T00:01:00.000Z')
    expect(f.writes()[0].text).toContain(
      'owner_id=? AND lease_ref=? AND generation=? AND expires_at>lease_clock.server_now'
    )
    expect(f.writes()[0].values.slice(-6)).toEqual([
      accountId,
      taskId,
      runId,
      token.ownerId,
      token.leaseRef,
      token.generation
    ])
  })

  it('cannot renew an expired or fenced lease', async () => {
    const f = fixture([[task], []])
    await expect(
      f.repository.renewDelivery(accountId, taskId, runId, { ...token, leaseMs: 30_000 })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('retains the issued proof horizon when a shorter renewal expires before ordinary takeover', async () => {
    const renewed = row({
      expires_at: new Date('2026-10-04T00:00:21.000Z'),
      server_now: new Date('2026-10-04T00:00:20.000Z')
    })
    const expired = { ...renewed, server_now: new Date('2026-10-04T00:00:25.000Z') }
    const f = fixture([[task], [renewed], [task], [], [expired], []])
    await f.repository.renewDelivery(accountId, taskId, runId, { ...token, leaseMs: 1000 })
    const next = {
      ownerId: 'gateway:next',
      leaseRef: 'delivery:next',
      expectedGeneration: 1,
      leaseMs: 30_000
    }
    await expect(f.repository.claimDelivery(accountId, taskId, runId, next)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()[0].text).toContain(
      "takeover_after=GREATEST(takeover_after,lease_clock.server_now+?*interval '1 millisecond')"
    )
    expect(f.writes()[1].text).toContain('takeover_after<=lease_clock.server_now')
    expect(f.transactions).toEqual(['begin', 'commit', 'begin', 'rollback'])
  })

  it('releases only the lease and retains the original execution and task checkout', async () => {
    const released = row({ expires_at: new Date('2026-10-04T00:00:00.000Z') })
    const f = fixture([[{ ...task, cancel_requested: true }], [released]])
    expect((await f.repository.releaseDelivery(accountId, taskId, runId, token)).generation).toBe(1)
    expect(f.writes()).toHaveLength(1)
    expect(f.writes()[0].text).toContain('SET expires_at=LEAST(expires_at,clock_timestamp())')
    expect(f.writes()[0].text).toContain('owner_id=? AND lease_ref=? AND generation=?')
    expect(f.writes()[0].text).not.toMatch(/heartbeat_runs|checkout_run_id|result_receipt/)
    expect(f.writes()[0].text).not.toContain('takeover_after=')
  })

  it('rejects release by a stale delivery owner', async () => {
    const f = fixture([[task], []])
    await expect(f.repository.releaseDelivery(accountId, taskId, runId, token)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
  })

  it('does not allow ordinary takeover after early release while the issued proof is still valid', async () => {
    const released = row({
      expires_at: new Date('2026-10-04T00:00:10.000Z'),
      server_now: new Date('2026-10-04T00:00:10.000Z')
    })
    const f = fixture([[task], [released], [task], [], [released], []])
    await f.repository.releaseDelivery(accountId, taskId, runId, token)
    const next = {
      ownerId: 'gateway:next',
      leaseRef: 'delivery:next',
      expectedGeneration: 1,
      leaseMs: 30_000
    }
    await expect(f.repository.claimDelivery(accountId, taskId, runId, next)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()[0].text).not.toContain('takeover_after=')
    expect(f.writes()[1].text).toContain(
      'expires_at<=lease_clock.server_now AND takeover_after<=lease_clock.server_now'
    )
    expect(f.transactions).toEqual(['begin', 'commit', 'begin', 'rollback'])
  })

  it('reads the current proof only inside the authenticated account and company/run scope', async () => {
    const f = fixture([[task], [row()]])
    const current = await f.repository.getCurrentDelivery(accountId, companyId, runId)
    expect(current).toMatchObject({
      accountId,
      companyId,
      runId,
      ...token,
      commandFingerprint: binding.commandFingerprint
    })
    expect(f.calls[0].values).toEqual([companyId, runId])
    expect(
      f.calls.some((call) => call.text.includes('b.account_id=? AND i.id=? AND b.run_id=?'))
    ).toBe(true)
    expect(f.calls.at(-1).values).toEqual([accountId, taskId, runId])
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.writes()).toHaveLength(0)
  })

  it('returns no proof for an owned run with no delivery and denies a foreign run', async () => {
    const owned = fixture([[task], []])
    expect(await owned.repository.getCurrentDelivery(accountId, companyId, runId)).toBeNull()
    const foreign = fixture([[]])
    await expect(
      foreign.repository.getCurrentDelivery(accountId, companyId, runId)
    ).rejects.toThrow('FORBIDDEN')
    expect(foreign.writes()).toHaveLength(0)
  })

  it.each(['', null, 'x'.repeat(513)])(
    'denies malformed authenticated identity %s before SQL',
    async (identity) => {
      const f = fixture()
      await expect(f.repository.getCurrentDelivery(identity, companyId, runId)).rejects.toThrow(
        'FORBIDDEN'
      )
      expect(f.calls).toHaveLength(0)
    }
  )

  it('returns a bounded owned recovery page without manufacturing runs', async () => {
    const tasks = [task, { ...task, id: randomUUID() }]
    const f = fixture([tasks])
    const page = await f.repository.listRecoverableRuns(accountId, { limit: 1 })
    expect(page).toEqual({ items: [task], nextCursor: task.run_id })
    expect(f.calls[0].text).toContain('b.result_receipt IS NULL')
    expect(f.calls[0].text).toContain(
      '(b.binding IS NOT NULL OR (r.case_id IS NOT NULL AND b.workflow_input IS NOT NULL'
    )
    expect(f.calls[0].text).toContain(
      "h.status='queued' AND h.execution_stage IS NULL AND NOT b.cancel_requested"
    )
    expect(f.calls[0].text).toContain('ORDER BY b.run_id ASC LIMIT ?')
    expect(f.calls[0].values).toEqual([accountId, null, null, 2])
    expect(f.writes()).toHaveLength(0)
  })

  it('requires a current token before advancing a leased run from queued to running', async () => {
    const f = fixture([[task], [{ task_id: taskId }]])
    await expect(f.repository.claimDispatch(accountId, taskId, runId)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('does not let a stale owner mark the new owner execution unknown', async () => {
    const f = fixture([[task], []])
    await expect(f.repository.unknown(accountId, taskId, runId, token)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('keeps execution tuple uniqueness and cursor/receipt constraints in the additive schema', async () => {
    const ddl = await readFile(
      new URL('../../integration/paperclip/service/task-tables.sql', import.meta.url),
      'utf8'
    )
    expect(ddl).toContain(
      'PRIMARY KEY(runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint,sequence)'
    )
    expect(ddl).toContain(
      'REFERENCES hive_task_deliveries(task_id,account_id,run_id,runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint)'
    )
    expect(ddl).toContain('CHECK (last_sequence BETWEEN event_cursor AND 9007199254740991)')
    expect(ddl).toContain('CHECK (takeover_after>=expires_at)')
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS hive_task_delivery_claim_receipts')
    expect(ddl).toContain('UNIQUE(run_id,generation)')
    expect(ddl).toContain(
      'FOREIGN KEY(task_id,account_id,run_id) REFERENCES hive_task_deliveries(task_id,account_id,run_id)'
    )
    expect(ddl).not.toMatch(/DROP |DELETE |UPDATE (issues|heartbeat_runs)/)
  })
})
