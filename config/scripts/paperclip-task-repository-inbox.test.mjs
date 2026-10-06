import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { taskCommand } from '../../src/main/tasks/task-execution.test-fixture.ts'
import { computeTaskExecutionFingerprint } from '../../src/shared/task-execution/task-execution-fingerprint.ts'

const accountId = 'account:inbox-tests'
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
  bindingRef: 'binding:inbox-tests',
  paperclipCompanyId: companyId,
  paperclipAgentId: agentId,
  command,
  commandFingerprint: computeTaskExecutionFingerprint(command, 'trusted-local:runtime')
}
const identity = {
  protocolVersion: 1,
  runtimeRecordId: command.runtimeRecordId,
  ownershipEpoch: command.ownershipEpoch,
  executionId: command.executionId,
  executionEpoch: command.executionEpoch,
  commandFingerprint: binding.commandFingerprint
}
const recordedAt = '2026-10-04T00:00:00.000Z'
const accepted = {
  ...identity,
  kind: 'execution.accepted',
  receiptId: 'accepted:inbox-tests',
  recordedAt,
  status: 'accepted',
  operationId: command.operationId,
  workspaceExecutionClaimRef: command.workspaceExecutionClaimRef,
  writeFence: command.writeFence
}
const receipt = {
  ...identity,
  kind: 'execution.result',
  recordedAt,
  receiptId: 'result:inbox-tests',
  status: 'succeeded',
  outcomeRef: 'outcome:inbox-tests',
  artifactRefs: [],
  usageFactRefs: [],
  stopProof: {
    proofRef: 'stop:inbox-tests',
    evidenceKind: 'stopped',
    managedToolsSettled: true,
    writersFenced: true,
    recordedAt
  }
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
  run_scope: {
    kind: 'personal',
    accountId,
    companyId,
    employeeRef: agentId,
    workspaceSelector: undefined
  }
}
const settledTask = {
  ...task,
  result_receipt: receipt,
  status_version: 2,
  checkout_run_id: null,
  status: 'in_review'
}
const token = { ownerId: 'gateway:inbox-tests', leaseRef: 'delivery:inbox-tests', generation: 1 }
const event = (sequence, status, changes = {}) => ({
  ...identity,
  kind: 'execution.event',
  eventId: `event:inbox-tests:${sequence}`,
  recordedAt,
  sequence,
  status,
  artifactRefs: [],
  ...changes
})
const observation = (events, result = null, changes = {}) => ({
  ...identity,
  kind: 'execution.observation',
  accepted,
  events,
  cursor: events.at(-1)?.sequence ?? 0,
  lastSequence: events.at(-1)?.sequence ?? 1,
  status: result?.status ?? events.at(-1)?.status ?? 'running',
  sessionRef: 'session:inbox-tests',
  result,
  ...changes
})
const delivery = (cursor = 0, changes = {}) => ({
  task_id: taskId,
  account_id: accountId,
  run_id: runId,
  protocol_version: 1,
  runtime_record_id: command.runtimeRecordId,
  ownership_epoch: command.ownershipEpoch,
  execution_id: command.executionId,
  execution_epoch: command.executionEpoch,
  command_fingerprint: binding.commandFingerprint,
  owner_id: token.ownerId,
  lease_ref: token.leaseRef,
  generation: '1',
  event_cursor: String(cursor),
  last_sequence: String(cursor),
  expires_at: new Date('2026-10-04T00:00:30.000Z'),
  server_now: new Date(recordedAt),
  accepted_receipt: cursor ? accepted : null,
  accepted_hash: cursor ? digest(accepted) : null,
  terminal_sequence: null,
  terminal_receipt: null,
  terminal_hash: null,
  ...changes
})

function fixture(replies = []) {
  const calls = [],
    transactions = []
  const db = vi.fn(async (strings, ...values) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim()
    calls.push({ text, values })
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
  db.begin = vi.fn(async (run) => {
    transactions.push('begin')
    try {
      const result = await run(db)
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
    writes: () => calls.filter((call) => /^(INSERT|UPDATE|DELETE)/.test(call.text)),
    businessWrites: () =>
      calls.filter((call) => /^UPDATE (hive_task_bindings|issues|heartbeat_runs) /.test(call.text)),
    remaining: () => replies.length
  }
}

function terminalReplies(events, startingDelivery = delivery(), result = receipt) {
  const finalCursor = events.at(-1).sequence
  const current = delivery(finalCursor, {
    terminal_sequence: finalCursor,
    terminal_receipt: result,
    terminal_hash: digest(result)
  })
  const finalTask = { ...settledTask, result_receipt: result }
  return [
    [task],
    [startingDelivery],
    ...events.map((item) => [{ payload_hash: digest(item) }]),
    [{ task_id: taskId }],
    [{ payload_hash: digest(events.at(-1)), payload: events.at(-1) }],
    [task],
    [current],
    [],
    [],
    [{ id: runId }],
    [finalTask],
    [current],
    [current]
  ]
}

describe('task execution inbox and transactional business settlement', () => {
  it('commits a contiguous page and acknowledges only its durable cursor', async () => {
    const first = event(1, 'accepted')
    const f = fixture([
      [task],
      [delivery()],
      [{ payload_hash: digest(first) }],
      [{ task_id: taskId }],
      [delivery(1, { last_sequence: '2' })]
    ])
    const result = await f.repository.consumeObservation(
      accountId,
      taskId,
      runId,
      token,
      observation([first], null, { lastSequence: 2, status: 'running' })
    )
    expect(result).toMatchObject({ cursor: 1, lastSequence: 2, needsReplay: true, settled: false })
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.transactions).toEqual(['begin', 'commit'])
    expect(f.businessWrites()).toHaveLength(0)
    expect(f.writes()[0].text).toContain(
      'ON CONFLICT (runtime_record_id,ownership_epoch,execution_id,execution_epoch,command_fingerprint,sequence) DO NOTHING'
    )
    expect(f.writes()[1].text).toContain(
      'owner_id=? AND lease_ref=? AND generation=? AND expires_at>clock_timestamp()'
    )
    expect(f.writes()[1].values[0]).toBe(1)
    expect(f.remaining()).toBe(0)
  })

  it.each([
    observation([event(2, 'running')]),
    observation([], null, { cursor: 2, lastSequence: 2 })
  ])(
    'rejects a missing page prefix or empty cursor jump without advancing durable state',
    async (value) => {
      const f = fixture([[task], [delivery()]])
      await expect(
        f.repository.consumeObservation(accountId, taskId, runId, token, value)
      ).rejects.toThrow('SEQUENCE_GAP')
      expect(f.writes()).toHaveLength(0)
      expect(f.transactions).toEqual(['begin', 'rollback'])
    }
  )

  it('rejects an internally noncontiguous page before opening a transaction', async () => {
    const f = fixture()
    await expect(
      f.repository.consumeObservation(
        accountId,
        taskId,
        runId,
        token,
        observation([event(1, 'accepted'), event(3, 'running')])
      )
    ).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
    expect(f.sql.begin).not.toHaveBeenCalled()
  })

  it('returns the original cursor for duplicate event content without another business effect', async () => {
    const first = event(1, 'accepted')
    const f = fixture([
      [task],
      [delivery(1)],
      [],
      [{ payload_hash: digest(first), payload: first }],
      [{ task_id: taskId }],
      [delivery(1)]
    ])
    expect(
      await f.repository.consumeObservation(accountId, taskId, runId, token, observation([first]))
    ).toMatchObject({ cursor: 1, needsReplay: false })
    expect(f.businessWrites()).toHaveLength(0)
    expect(
      f.calls.find((call) =>
        call.text.includes('SELECT payload_hash,payload FROM hive_task_event_inbox')
      )?.values
    ).toEqual([
      accountId,
      taskId,
      runId,
      command.runtimeRecordId,
      command.ownershipEpoch,
      command.executionId,
      command.executionEpoch,
      binding.commandFingerprint,
      1
    ])
  })

  it('rejects the same sequence with different content instead of replacing its payload', async () => {
    const original = event(1, 'accepted')
    const changed = { ...original, summary: 'different content' }
    const f = fixture([
      [task],
      [delivery(1)],
      [],
      [{ payload_hash: digest(original), payload: original }]
    ])
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation([changed]))
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(1)
    expect(f.writes()[0].text).not.toContain('DO UPDATE')
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('rejects stored payload/hash disagreement during duplicate replay', async () => {
    const first = event(1, 'accepted')
    const f = fixture([
      [task],
      [delivery(1)],
      [],
      [{ payload_hash: digest(first), payload: { ...first, summary: 'corrupted' } }]
    ])
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation([first]))
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.businessWrites()).toHaveLength(0)
  })

  it('refuses to reconstruct an already acknowledged event whose inbox proof disappeared', async () => {
    const first = event(1, 'accepted')
    const f = fixture([[task], [delivery(1)], [{ payload_hash: digest(first) }]])
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation([first]))
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('denies an event tuple from a different execution even when the whole page is internally consistent', async () => {
    const value = observation([event(1, 'accepted')])
    const foreign = {
      ...value,
      executionId: 'execution:foreign',
      accepted: { ...accepted, executionId: 'execution:foreign' },
      events: value.events.map((item) => ({ ...item, executionId: 'execution:foreign' }))
    }
    const f = fixture([[task]])
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, foreign)
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects a mismatched accepted write fence before inbox writes', async () => {
    const f = fixture([[task]])
    const value = observation([event(1, 'accepted')], null, {
      accepted: { ...accepted, writeFence: accepted.writeFence + 1 }
    })
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, value)
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('rejects a stale owner before persisting any received event', async () => {
    const f = fixture([[task], []])
    await expect(
      f.repository.consumeObservation(
        accountId,
        taskId,
        runId,
        token,
        observation([event(1, 'accepted')])
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.writes()).toHaveLength(0)
  })

  it('rolls back an inbox attempt when the lease expires before its cursor CAS', async () => {
    const first = event(1, 'accepted')
    const f = fixture([[task], [delivery()], [{ payload_hash: digest(first) }], []])
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation([first]))
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.businessWrites()).toHaveLength(0)
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('stores a terminal receipt while requiring missing events before business settlement', async () => {
    const first = event(1, 'accepted')
    const pending = delivery(1, {
      last_sequence: '3',
      terminal_sequence: '3',
      terminal_receipt: receipt,
      terminal_hash: digest(receipt)
    })
    const f = fixture([
      [task],
      [delivery()],
      [{ payload_hash: digest(first) }],
      [{ task_id: taskId }],
      [pending]
    ])
    const result = await f.repository.consumeObservation(
      accountId,
      taskId,
      runId,
      token,
      observation([first], receipt, { lastSequence: 3 })
    )
    expect(result).toMatchObject({ cursor: 1, lastSequence: 3, needsReplay: true, settled: false })
    expect(f.businessWrites()).toHaveLength(0)
    expect(f.writes()[1].values).toContainEqual(receipt)
    expect(f.writes()[1].values).toContain(digest(receipt))
  })

  it('commits terminal events, cursor, receipt, issue and run in one database transaction', async () => {
    const events = [event(1, 'accepted'), event(2, 'succeeded')]
    const f = fixture(terminalReplies(events))
    const result = await f.repository.consumeObservation(
      accountId,
      taskId,
      runId,
      token,
      observation(events, receipt)
    )
    expect(result).toMatchObject({
      cursor: 2,
      lastSequence: 2,
      needsReplay: false,
      settled: true,
      task: settledTask
    })
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.transactions).toEqual(['begin', 'commit'])
    expect(f.businessWrites().map((call) => call.text.split(' ')[1])).toEqual([
      'hive_task_bindings',
      'issues',
      'heartbeat_runs'
    ])
    expect(f.businessWrites()[0].values[0]).toEqual(receipt)
    expect(f.remaining()).toBe(0)
  })

  it('finishes the original pending terminal from the following contiguous page', async () => {
    const pending = delivery(1, {
      last_sequence: '3',
      terminal_sequence: '3',
      terminal_receipt: receipt,
      terminal_hash: digest(receipt)
    })
    const events = [event(2, 'running'), event(3, 'succeeded')]
    const f = fixture(terminalReplies(events, pending))
    expect(
      await f.repository.consumeObservation(
        accountId,
        taskId,
        runId,
        token,
        observation(events, receipt)
      )
    ).toMatchObject({ cursor: 3, settled: true })
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.remaining()).toBe(0)
  })

  it('rejects a changed terminal receipt under an already recorded terminal version', async () => {
    const pending = delivery(1, {
      last_sequence: '2',
      terminal_sequence: '2',
      terminal_receipt: receipt,
      terminal_hash: digest(receipt)
    })
    const f = fixture([[task], [pending]])
    const changed = { ...receipt, receiptId: 'result:conflicting' }
    await expect(
      f.repository.consumeObservation(
        accountId,
        taskId,
        runId,
        token,
        observation([event(2, 'succeeded')], changed)
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('does not append new events after the established terminal version', async () => {
    const pending = delivery(1, {
      last_sequence: '2',
      terminal_sequence: '2',
      terminal_receipt: receipt,
      terminal_hash: digest(receipt)
    })
    const f = fixture([[task], [pending]])
    await expect(
      f.repository.consumeObservation(
        accountId,
        taskId,
        runId,
        token,
        observation([event(2, 'running'), event(3, 'succeeded')], receipt)
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('requires the terminal event to agree with the persisted result artifacts', async () => {
    const changed = { ...receipt, artifactRefs: ['artifact:report'] }
    const events = [event(1, 'accepted'), event(2, 'succeeded')]
    const replies = terminalReplies(events, delivery(), changed).slice(0, 6)
    const f = fixture(replies)
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation(events, changed))
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.businessWrites()).toHaveLength(0)
    expect(f.transactions).toEqual(['begin', 'rollback'])
  })

  it('rolls back all result projections when ownership expires before the final check', async () => {
    const events = [event(1, 'accepted'), event(2, 'succeeded')]
    const replies = terminalReplies(events).slice(0, -2).concat([[]])
    const f = fixture(replies)
    await expect(
      f.repository.consumeObservation(accountId, taskId, runId, token, observation(events, receipt))
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    expect(f.businessWrites()).toHaveLength(3)
    expect(f.transactions).toEqual(['begin', 'rollback'])
    expect(f.remaining()).toBe(0)
  })

  it('does not let direct settlement bypass an incomplete managed inbox', async () => {
    const pending = delivery(1, {
      last_sequence: '2',
      terminal_sequence: '2',
      terminal_receipt: receipt,
      terminal_hash: digest(receipt)
    })
    const f = fixture([[task], [pending]])
    await expect(f.repository.settle(accountId, taskId, runId, receipt, token)).rejects.toThrow(
      'OUTCOME_UNKNOWN'
    )
    expect(f.writes()).toHaveLength(0)
  })

  it('replays a committed business receipt after response loss without any lease renewal or write', async () => {
    const f = fixture([[settledTask]])
    expect(await f.repository.settle(accountId, taskId, runId, receipt)).toEqual(settledTask)
    expect(f.writes()).toHaveLength(0)
    expect(f.calls.some((call) => call.text.includes('FROM hive_task_deliveries'))).toBe(false)
  })

  it('rejects a conflicting replay of the committed business receipt', async () => {
    const f = fixture([[settledTask]])
    await expect(
      f.repository.settle(accountId, taskId, runId, { ...receipt, receiptId: 'result:other' })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(f.writes()).toHaveLength(0)
  })

  it('settles an existing unleased binding using the same Paperclip transaction and source receipt', async () => {
    const f = fixture([[task], [], [], [], [{ id: runId }], [settledTask]])
    expect(await f.repository.settle(accountId, taskId, runId, receipt)).toEqual(settledTask)
    expect(f.businessWrites()).toHaveLength(3)
    expect(f.sql.begin).toHaveBeenCalledTimes(1)
    expect(f.remaining()).toBe(0)
  })
})
