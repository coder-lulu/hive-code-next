import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
const outcome = (promise) =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  )

/** Synthetic receipts validate real PostgreSQL transactions; no Runtime or Codex process is launched. */
describe.skipIf(!configPath)('isolated real PostgreSQL delivery and inbox regression', () => {
  let h
  beforeAll(async () => {
    h = await createPostgresTaskHarness(configPath)
  })
  afterAll(async () => {
    await h?.close()
  })

  const claim = async (context, leaseMs = 30_000) => {
    const input = h.claimInput(0, leaseMs)
    const proof = await h.repository.claimDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      input
    )
    return { input, proof, token: h.token(proof) }
  }
  const retained = (state, context) => {
    expect(state.task).toMatchObject({
      checkout_run_id: context.task.run_id,
      status: 'in_progress',
      result_receipt: null
    })
    expect(Number(state.task.status_version)).toBe(1)
    expect(state.run.finished_at).toBeNull()
    expect(state.run.result_json).toBeNull()
  }

  it('persists shutdown handoff twice without cancelling, settling or releasing the original slot', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    await h.repository.claimDispatch(context.accountId, context.task.id, context.task.run_id, token)
    const before = await h.snapshot(context)
    await h.repository.drain(context.accountId, context.task.id, context.task.run_id)
    const [first] =
      await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
    await h.repository.drain(context.accountId, context.task.id, context.task.run_id)
    const [second] =
      await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
    expect(first.context_snapshot.externalExecutionControl.drain.reason).toBe('delivery_shutdown')
    expect(second.context_snapshot).toEqual(first.context_snapshot)
    const after = await h.snapshot(context)
    retained(after, context)
    expect(after.task.cancel_requested).toBe(false)
    expect(after.run.status).toBe('running')
    expect(after.delivery.expires_at).toEqual(before.delivery.expires_at)
    expect(after.delivery.generation).toBe(before.delivery.generation)
    expect(after.inbox).toBe(0)
  })

  it('refuses a changed run driver after waiting for the original heartbeat lock', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    let pending
    await h.sql.begin(async (db) => {
      const [session] = await db`SELECT pg_backend_pid() AS pid`
      await db`SELECT id FROM heartbeat_runs WHERE id=${context.task.run_id} FOR UPDATE`
      pending = outcome(
        h.repository.claimDispatch(context.accountId, context.task.id, context.task.run_id, token)
      )
      await h.waitForLocks(session.pid, 1, '%JOIN heartbeat_runs h%FOR SHARE OF i,b,h%')
      await db`UPDATE heartbeat_runs SET driver_kind='codex_local' WHERE id=${context.task.run_id}`
    })
    expect(await pending).toMatchObject({
      status: 'rejected',
      reason: { code: 'FORBIDDEN' }
    })
    const state = await h.snapshot(context)
    retained(state, context)
    expect(state.run.status).toBe('queued')
    expect(state.run.execution_stage).toBeNull()
    expect(state.task.driver_kind).toBe('codex_local')
  })

  it('redelivers the core cancellation marker without replacing its intent or clearing the task lock', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    await h.repository.claimDispatch(context.accountId, context.task.id, context.task.run_id, token)
    const intent = { reason: 'company_budget_pause', requestedAt: new Date().toISOString() }
    await h.sql`UPDATE heartbeat_runs SET context_snapshot=${h.sql.json({ externalExecutionControl: { cancel: intent } })}
      WHERE id=${context.task.run_id}`
    expect(
      (await h.repository.read(context.accountId, context.task.id, context.task.run_id))
        .cancel_requested
    ).toBe(true)
    expect((await h.repository.list(context.accountId))[0].cancel_requested).toBe(true)
    expect(
      (await h.repository.listRecoverableRuns(context.accountId)).items[0].cancel_requested
    ).toBe(true)
    await h.repository.drain(context.accountId, context.task.id, context.task.run_id)
    await h.repository.cancel(context.accountId, context.task.id, context.task.run_id)
    const [run] =
      await h.sql`SELECT context_snapshot FROM heartbeat_runs WHERE id=${context.task.run_id}`
    expect(run.context_snapshot.externalExecutionControl.cancel).toEqual(intent)
    expect(run.context_snapshot.externalExecutionControl.drain.reason).toBe('delivery_shutdown')
    retained(await h.snapshot(context), context)
  })

  it('retains operator cancellation facts only after a complete stopped receipt', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    await h.repository.claimDispatch(context.accountId, context.task.id, context.task.run_id, token)
    const intent = {
      reason: 'operator_stop',
      errorCode: 'operator_interrupted',
      requestedAt: new Date().toISOString(),
      resultJson: {
        cancelledByActorType: 'user',
        cancelledByUserId: 'board-user',
        status: 'forged-status'
      }
    }
    await h.sql`UPDATE heartbeat_runs SET context_snapshot=${h.sql.json({ externalExecutionControl: { cancel: intent } })}
      WHERE id=${context.task.run_id}`
    retained(await h.snapshot(context), context)
    const receipt = { ...context.result, status: 'cancelled' }
    const events = [
      context.event(1, 'accepted'),
      context.event(2, 'running'),
      context.event(3, 'cancelled')
    ]
    await h.repository.consumeObservation(
      context.accountId,
      context.task.id,
      context.task.run_id,
      token,
      context.observation(events, receipt)
    )
    const state = await h.snapshot(context)
    expect(state.task.result_receipt).toEqual(receipt)
    expect(state.run).toMatchObject({
      status: 'cancelled',
      error_code: 'operator_interrupted',
      result_json: {
        ...receipt,
        cancelledByActorType: 'user',
        cancelledByUserId: 'board-user'
      }
    })
    expect(state.task.checkout_run_id).toBeNull()
    expect(state.task.execution_run_id).toBeNull()
  })

  it('rolls back inbox, receipt and issue settlement when the persisted run no longer belongs to Hive', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    await h.repository.claimDispatch(context.accountId, context.task.id, context.task.run_id, token)
    await h.sql`UPDATE heartbeat_runs SET driver_kind='codex' WHERE id=${context.task.run_id}`
    const events = [context.event(1, 'accepted'), context.event(2, 'succeeded')]
    await expect(
      h.repository.consumeObservation(
        context.accountId,
        context.task.id,
        context.task.run_id,
        token,
        context.observation(events, context.result)
      )
    ).rejects.toThrow('FORBIDDEN')
    const state = await h.snapshot(context)
    retained(state, context)
    expect(state.inbox).toBe(0)
    expect(Number(state.delivery.event_cursor)).toBe(0)
    expect(state.run.status).toBe('running')
  })

  it('applies the additive DDL twice without resetting committed lease or inbox state', async () => {
    const context = await h.newTask()
    const { token, proof } = await claim(context)
    const first = context.event(1, 'accepted')
    await h.repository.consumeObservation(
      context.accountId,
      context.task.id,
      context.task.run_id,
      token,
      context.observation([first])
    )
    const ddl = await readFile(
      new URL('../../integration/paperclip/service/task-tables.sql', import.meta.url),
      'utf8'
    )
    await h.sql.unsafe(ddl)
    await h.sql.unsafe(ddl)
    const state = await h.snapshot(context)
    expect(state).toMatchObject({ inbox: 1, claims: 1 })
    expect(Number(state.delivery.event_cursor)).toBe(1)
    expect(state.delivery.lease_ref).toBe(proof.leaseRef)
    expect(state.delivery.expires_at.toISOString()).toBe(proof.expiresAt)
    retained(state, context)
  })

  it('coalesces concurrent identical claims into one immutable generation and response', async () => {
    const context = await h.newTask()
    const input = h.claimInput()
    const proofs = await Promise.all(
      Array.from({ length: 6 }, () =>
        h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, input)
      )
    )
    expect(
      proofs.every((proof) => proof.generation === 1 && proof.expiresAt === proofs[0].expiresAt)
    ).toBe(true)
    const state = await h.snapshot(context)
    expect(state.claims).toBe(1)
    expect(Number(state.delivery.generation)).toBe(1)
    const [receipt] =
      await h.sql`SELECT request_hash,receipt_hash,receipt FROM hive_task_delivery_claim_receipts
      WHERE account_id=${context.accountId} AND task_id=${context.task.id} AND run_id=${context.task.run_id} AND lease_ref=${input.leaseRef}`
    expect(receipt.request_hash).toBe(
      digest({
        accountId: context.accountId,
        taskId: context.task.id,
        runId: context.task.run_id,
        commandFingerprint: context.binding.commandFingerprint,
        kind: 'delivery',
        input
      })
    )
    expect(receipt.receipt_hash).toBe(digest(receipt.receipt))
    await expect(
      h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, {
        ...input,
        leaseMs: 20_000
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  })

  it('admits exactly one of concurrent distinct first claim references', async () => {
    const context = await h.newTask()
    const calls = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        h.repository.claimDelivery(
          context.accountId,
          context.task.id,
          context.task.run_id,
          h.claimInput()
        )
      )
    )
    expect(calls.filter((call) => call.status === 'fulfilled')).toHaveLength(1)
    expect(
      calls
        .filter((call) => call.status === 'rejected')
        .every((call) => call.reason.code === 'OUTCOME_UNKNOWN')
    ).toBe(true)
    expect((await h.snapshot(context)).claims).toBe(1)
  })

  it('retains the issued horizon after release, then fences the old owner and replays its expired receipt', async () => {
    const context = await h.newTask()
    const first = await claim(context, 1000)
    await h.repository.claimDispatch(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token
    )
    await h.repository.releaseDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token
    )
    const released = await h.snapshot(context)
    expect(released.delivery.expired).toBe(true)
    expect(released.delivery.takeover_expired).toBe(false)
    expect(released.delivery.takeover_after.toISOString()).toBe(first.proof.expiresAt)
    const next = h.claimInput(1)
    await expect(
      h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, next)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    await h.waitForExpiry(released.delivery.takeover_after)
    const replacement = await h.repository.claimDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      next
    )
    expect(replacement.generation).toBe(2)
    const oldReplay = await h.repository.claimDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.input
    )
    expect(oldReplay).toMatchObject({
      generation: 1,
      expiresAt: first.proof.expiresAt,
      leaseRef: first.proof.leaseRef
    })
    expect(Date.parse(oldReplay.serverNow)).toBeGreaterThanOrEqual(Date.parse(oldReplay.expiresAt))
    await expect(
      h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, {
        ...first.input,
        ownerId: next.ownerId
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    const writes = [
      () =>
        h.repository.renewDelivery(context.accountId, context.task.id, context.task.run_id, {
          ...first.token,
          leaseMs: 1000
        }),
      () =>
        h.repository.releaseDelivery(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token
        ),
      () =>
        h.repository.unknown(context.accountId, context.task.id, context.task.run_id, first.token),
      () =>
        h.repository.claimDispatch(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token
        ),
      () =>
        h.repository.consumeObservation(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token,
          context.observation([context.event(1, 'accepted')])
        )
    ]
    for (const write of writes) {
      await expect(write()).rejects.toThrow('OUTCOME_UNKNOWN')
    }
    const state = await h.snapshot(context)
    expect(state.delivery.lease_ref).toBe(next.leaseRef)
    expect(state.claims).toBe(2)
    expect(state.inbox).toBe(0)
    expect(state.run.status).toBe('running')
    retained(state, context)
  })

  it('preserves the longer issued horizon when a short renewal expires', async () => {
    const context = await h.newTask()
    const first = await claim(context, 3000)
    const renewed = await h.repository.renewDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      {
        ...first.token,
        leaseMs: 1000
      }
    )
    expect(Date.parse(renewed.expiresAt)).toBeLessThan(Date.parse(first.proof.expiresAt))
    let state = await h.snapshot(context)
    expect(state.delivery.takeover_after.toISOString()).toBe(first.proof.expiresAt)
    await h.waitForExpiry(state.delivery.expires_at)
    await expect(
      h.repository.renewDelivery(context.accountId, context.task.id, context.task.run_id, {
        ...first.token,
        leaseMs: 1000
      })
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    const next = h.claimInput(1)
    await expect(
      h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, next)
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    await h.repository.releaseDelivery(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token
    )
    state = await h.snapshot(context)
    expect(state.delivery.takeover_after.toISOString()).toBe(first.proof.expiresAt)
    await h.waitForExpiry(state.delivery.takeover_after)
    const takeovers = await Promise.allSettled(
      [next, ...Array.from({ length: 5 }, () => h.claimInput(1))].map((input) =>
        h.repository.claimDelivery(context.accountId, context.task.id, context.task.run_id, input)
      )
    )
    expect(takeovers.filter((call) => call.status === 'fulfilled')).toHaveLength(1)
    expect(takeovers.find((call) => call.status === 'fulfilled').value.generation).toBe(2)
    expect(
      takeovers
        .filter((call) => call.status === 'rejected')
        .every((call) => call.reason.code === 'OUTCOME_UNKNOWN')
    ).toBe(true)
    retained(await h.snapshot(context), context)
  })

  it('serializes real renew/release lock contention without shortening the issued horizon', async () => {
    const context = await h.newTask()
    const first = await claim(context, 10_000)
    const pending = await h.withRowLock(context, 'issues', async (blockerPid) => {
      const renewal = outcome(
        h.repository.renewDelivery(context.accountId, context.task.id, context.task.run_id, {
          ...first.token,
          leaseMs: 1000
        })
      )
      const release = outcome(
        h.repository.releaseDelivery(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token
        )
      )
      const transfer = outcome(
        h.repository.claimDelivery(
          context.accountId,
          context.task.id,
          context.task.run_id,
          h.claimInput(1)
        )
      )
      await h.waitForLocks(blockerPid, 3)
      return { renewal, release, transfer }
    })
    const [renewal, release, transfer] = await Promise.all([
      pending.renewal,
      pending.release,
      pending.transfer
    ])
    expect(release.status).toBe('fulfilled')
    expect(transfer).toMatchObject({ status: 'rejected', reason: { code: 'OUTCOME_UNKNOWN' } })
    if (renewal.status === 'rejected') {
      expect(renewal.reason.code).toBe('OUTCOME_UNKNOWN')
    }
    const state = await h.snapshot(context)
    expect(state.delivery.expired).toBe(true)
    expect(state.delivery.takeover_after.toISOString()).toBe(first.proof.expiresAt)
    await expect(
      h.repository.claimDelivery(
        context.accountId,
        context.task.id,
        context.task.run_id,
        h.claimInput(1)
      )
    ).rejects.toThrow('OUTCOME_UNKNOWN')
    retained(state, context)
  })

  it('rejects an inbox writer whose lease expires while waiting for the task lock', async () => {
    const context = await h.newTask()
    const first = await claim(context, 1000)
    const { pending } = await h.withRowLock(context, 'issues', async (blockerPid) => {
      const pending = outcome(
        h.repository.consumeObservation(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token,
          context.observation([context.event(1, 'accepted')])
        )
      )
      await h.waitForLocks(blockerPid)
      await h.waitForExpiry(first.proof.expiresAt)
      return { pending }
    })
    expect(await pending).toMatchObject({ status: 'rejected', reason: { code: 'OUTCOME_UNKNOWN' } })
    const state = await h.snapshot(context)
    expect(state.inbox).toBe(0)
    expect(Number(state.delivery.event_cursor)).toBe(0)
    retained(state, context)
  })

  it('rolls back inbox and all business projections when terminal settlement waits beyond lease expiry', async () => {
    const context = await h.newTask()
    const first = await claim(context, 1500)
    await h.repository.claimDispatch(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token
    )
    const events = [context.event(1, 'accepted'), context.event(2, 'succeeded')]
    const { pending } = await h.withRowLock(context, 'heartbeat_runs', async (blockerPid) => {
      const pending = outcome(
        h.repository.consumeObservation(
          context.accountId,
          context.task.id,
          context.task.run_id,
          first.token,
          context.observation(events, context.result)
        )
      )
      await h.waitForLocks(blockerPid, 1, '%JOIN heartbeat_runs h%FOR SHARE OF i,b,h%')
      await h.waitForExpiry(first.proof.expiresAt)
      const invisible = await h.snapshot(context)
      expect(invisible.inbox).toBe(0)
      expect(Number(invisible.delivery.event_cursor)).toBe(0)
      retained(invisible, context)
      return { pending }
    })
    expect(await pending).toMatchObject({ status: 'rejected', reason: { code: 'OUTCOME_UNKNOWN' } })
    const state = await h.snapshot(context)
    expect(state.inbox).toBe(0)
    expect(Number(state.delivery.event_cursor)).toBe(0)
    expect(state.delivery.terminal_receipt).toBeNull()
    expect(state.run.status).toBe('running')
    retained(state, context)
  })

  it('rejects first-page gaps and empty cursor jumps before any durable receipt is written', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    for (const page of [
      context.observation([context.event(3, 'running')]),
      context.observation([], null, { cursor: 3, lastSequence: 3 })
    ]) {
      await expect(
        h.repository.consumeObservation(
          context.accountId,
          context.task.id,
          context.task.run_id,
          token,
          page
        )
      ).rejects.toThrow('SEQUENCE_GAP')
    }
    const state = await h.snapshot(context)
    expect(state.inbox).toBe(0)
    expect(Number(state.delivery.event_cursor)).toBe(0)
    expect(state.delivery.accepted_receipt).toBeNull()
  })

  it('deduplicates concurrent identical pages and rejects changed content for the same sequence', async () => {
    const context = await h.newTask()
    const { token } = await claim(context)
    const events = [context.event(1, 'accepted'), context.event(2, 'running')]
    const page = context.observation(events)
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        h.repository.consumeObservation(
          context.accountId,
          context.task.id,
          context.task.run_id,
          token,
          page
        )
      )
    )
    expect(results.every((result) => result.cursor === 2 && !result.settled)).toBe(true)
    const changed = context.observation([
      events[0],
      { ...events[1], summary: 'Conflicting payload' }
    ])
    await expect(
      h.repository.consumeObservation(
        context.accountId,
        context.task.id,
        context.task.run_id,
        token,
        changed
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    const state = await h.snapshot(context)
    expect(state.inbox).toBe(2)
    expect(Number(state.delivery.event_cursor)).toBe(2)
    const saved = await h.sql`SELECT payload_hash,payload FROM hive_task_event_inbox
      WHERE account_id=${context.accountId} AND task_id=${context.task.id} AND run_id=${context.task.run_id} ORDER BY sequence`
    expect(saved.map((event) => event.payload_hash)).toEqual(events.map(digest))
    expect(saved.every((event) => event.payload_hash === digest(event.payload))).toBe(true)
    retained(state, context)
  })
})
