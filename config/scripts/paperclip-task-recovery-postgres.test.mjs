import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTaskRepository } from '../../integration/paperclip/service/task-repository.mjs'
import { canonicalAgentSessionDigest as digest } from '../../src/shared/agent-session-mutation-envelope.ts'
import { createPostgresTaskHarness } from './paperclip-task-repository-postgres-fixture.mjs'

const configPath = process.env.HIVE_PAPERCLIP_P2_POSTGRES_CONFIG
const outcome = (promise) =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  )

/** Synthetic receipts validate real PostgreSQL transactions; no Runtime or Codex process is launched. */
describe.skipIf(!configPath)('isolated real PostgreSQL persisted recovery regression', () => {
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

  it('resumes a persisted terminal across repository recreation and consumes a lost response idempotently', async () => {
    const context = await h.newTask()
    const first = await claim(context)
    await h.repository.claimDispatch(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token
    )
    const initial = context.observation([context.event(1, 'accepted')], context.result, {
      lastSequence: 3
    })
    expect(
      await h.repository.consumeObservation(
        context.accountId,
        context.task.id,
        context.task.run_id,
        first.token,
        initial
      )
    ).toMatchObject({ cursor: 1, needsReplay: true, settled: false })
    const stored = await h.snapshot(context)
    expect(Number(stored.delivery.terminal_sequence)).toBe(3)
    retained(stored, context)
    const resumed = createTaskRepository(h.sql)
    const recoveryPage = await resumed.listRecoverableRuns(context.accountId, { limit: 1 })
    expect(recoveryPage.items).toHaveLength(1)
    expect(recoveryPage.items[0].run_id).toBe(context.task.run_id)
    expect(
      await resumed.getCurrentDelivery(
        context.accountId,
        context.task.company_id,
        context.task.run_id
      )
    ).toMatchObject({ ...first.token, cursor: 1 })
    const final = context.observation(
      [context.event(2, 'running'), context.event(3, 'succeeded')],
      context.result
    )
    // Deliberately discard the committed response, then retry through a fresh repository reader.
    await resumed.consumeObservation(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token,
      final
    )
    const replay = await createTaskRepository(h.sql).consumeObservation(
      context.accountId,
      context.task.id,
      context.task.run_id,
      first.token,
      final
    )
    expect(replay).toMatchObject({ cursor: 3, needsReplay: false, settled: true })
    const state = await h.snapshot(context)
    expect(state.inbox).toBe(3)
    expect(state.task).toMatchObject({
      checkout_run_id: null,
      execution_run_id: null,
      execution_locked_at: null,
      status: 'in_review',
      result_receipt: context.result
    })
    expect(Number(state.task.status_version)).toBe(2)
    expect(state.delivery.expires_at.toISOString()).toBe(first.proof.expiresAt)
    expect(state.run).toMatchObject({
      status: 'succeeded',
      execution_stage: 'settled',
      result_json: context.result
    })
    expect(state.run.finished_at).toBeInstanceOf(Date)
    expect((await resumed.listRecoverableRuns(context.accountId)).items).toHaveLength(0)
    await expect(
      resumed.consumeObservation(
        context.accountId,
        context.task.id,
        context.task.run_id,
        first.token,
        context.observation(final.events, { ...context.result, receiptId: 'result:p2-pg:changed' })
      )
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT')
    expect(Number((await h.snapshot(context)).task.status_version)).toBe(2)
  })

  it('requires the authenticated account and company/run scope for a complete delivery proof', async () => {
    const context = await h.newTask()
    const foreign = await h.newTask()
    const first = await claim(context)
    const proof = await h.repository.getCurrentDelivery(
      context.accountId,
      context.task.company_id,
      context.task.run_id
    )
    expect(proof).toMatchObject({
      accountId: context.accountId,
      companyId: context.task.company_id,
      taskId: context.task.id,
      runId: context.task.run_id,
      ...first.token,
      commandFingerprint: context.binding.commandFingerprint,
      runtimeRecordId: context.command.runtimeRecordId,
      ownershipEpoch: context.command.ownershipEpoch,
      executionId: context.command.executionId,
      executionEpoch: context.command.executionEpoch,
      operationId: context.command.operationId,
      workspaceExecutionClaimRef: context.command.workspaceExecutionClaimRef,
      writeFence: context.command.writeFence
    })
    await expect(
      h.repository.getCurrentDelivery(
        foreign.accountId,
        context.task.company_id,
        context.task.run_id
      )
    ).rejects.toThrow('FORBIDDEN')
    await expect(
      h.repository.getCurrentDelivery(
        context.accountId,
        foreign.task.company_id,
        context.task.run_id
      )
    ).rejects.toThrow('FORBIDDEN')
    expect((await h.snapshot(context)).claims).toBe(1)
  })
})
