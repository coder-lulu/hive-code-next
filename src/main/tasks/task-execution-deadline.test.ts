import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  TaskExecutionCancelSchema,
  TaskExecutionStartSchema
} from '../../shared/task-execution/task-execution-command'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import { TaskExecutionAcceptedSchema } from '../../shared/task-execution/task-execution-receipts'
import { taskExecutionDeadline, TASK_EXECUTION_TIMEOUT_MS } from './task-execution-budget'
import { taskDeadlineHostFixture } from './task-execution-deadline.test-fixture'
import { taskCommand, TASK_TEST_CALLER, TASK_TEST_NOW } from './task-execution.test-fixture'

const deadlineAt = (offset: number) => new Date(TASK_TEST_NOW + offset).toISOString()
function accepted() {
  const vectors = JSON.parse(
    readFileSync(resolve('integration/contracts/v1/test-vectors.json'), 'utf8')
  )
  return TaskExecutionAcceptedSchema.parse({
    ...vectors.examples.accepted,
    recordedAt: deadlineAt(0)
  })
}

describe('immutable Task execution deadline', () => {
  it('uses the earlier frozen workflow deadline without weakening the thirty-minute ceiling', () => {
    const receipt = accepted()
    expect(taskExecutionDeadline({ accepted: receipt })).toBe(
      TASK_TEST_NOW + TASK_EXECUTION_TIMEOUT_MS
    )
    expect(taskExecutionDeadline({ accepted: receipt, command: taskCommand() })).toBe(
      TASK_TEST_NOW + TASK_EXECUTION_TIMEOUT_MS
    )
    for (const offset of [1000, 5 * 60_000, TASK_EXECUTION_TIMEOUT_MS, 24 * 60 * 60_000]) {
      expect(
        taskExecutionDeadline({
          accepted: receipt,
          command: taskCommand({ executionDeadlineAt: deadlineAt(offset) })
        })
      ).toBe(TASK_TEST_NOW + Math.min(offset, TASK_EXECUTION_TIMEOUT_MS))
    }
  })

  it('binds the deadline into execution identity while authorization renewal leaves it unchanged', () => {
    const command = taskCommand({ executionDeadlineAt: deadlineAt(5000) })
    const fingerprint = computeTaskExecutionFingerprint(
      command,
      TASK_TEST_CALLER.operationCallerKey
    )
    const renewed = {
      ...command,
      expiresAt: deadlineAt(120_000),
      authorizationRef: 'authorization:renewed'
    }
    expect(computeTaskExecutionFingerprint(renewed, TASK_TEST_CALLER.operationCallerKey)).toBe(
      fingerprint
    )
    expect(taskExecutionDeadline({ accepted: accepted(), command: renewed })).toBe(
      TASK_TEST_NOW + 5000
    )
    expect(
      computeTaskExecutionFingerprint(
        { ...renewed, executionDeadlineAt: deadlineAt(10_000) },
        TASK_TEST_CALLER.operationCallerKey
      )
    ).not.toBe(fingerprint)
  })

  it.each(['not-a-date', '2026-02-30T00:00:00.000Z'])(
    'rejects invalid deadline %s before authorization, admission or launch',
    async (executionDeadlineAt) => {
      const h = await taskDeadlineHostFixture()
      const admit = vi.spyOn(h.deps.store, 'admit')
      const command = { ...taskCommand(), executionDeadlineAt }
      expect(TaskExecutionStartSchema.safeParse(command).success).toBe(false)
      expect(() => taskExecutionDeadline({ accepted: accepted(), command })).toThrow(
        'INVALID_REQUEST'
      )
      await expect(h.host.start(command, TASK_TEST_CALLER)).rejects.toThrow('INVALID_REQUEST')
      expect(h.deps.authorize).not.toHaveBeenCalled()
      expect(admit).not.toHaveBeenCalled()
      expect(h.deps.launch).not.toHaveBeenCalled()
    }
  )

  it.each([-1, 0])(
    'refuses an expired start deadline at offset %s before all effects',
    async (offset) => {
      const h = await taskDeadlineHostFixture()
      const admit = vi.spyOn(h.deps.store, 'admit')
      const command = taskCommand({ executionDeadlineAt: deadlineAt(offset) })
      await expect(h.host.start(command, TASK_TEST_CALLER)).rejects.toThrow('FORBIDDEN')
      expect(h.deps.authorize).not.toHaveBeenCalled()
      expect(admit).not.toHaveBeenCalled()
      expect(h.deps.store.get(command)).toBeNull()
      expect(h.deps.launch).not.toHaveBeenCalled()
    }
  )

  it('rechecks a deadline that expires during authorization before admission', async () => {
    const h = await taskDeadlineHostFixture()
    const command = taskCommand({ executionDeadlineAt: deadlineAt(1000) })
    const admit = vi.spyOn(h.deps.store, 'admit')
    h.deps.authorize.mockImplementation(async () => {
      h.setNow(TASK_TEST_NOW + 1000)
      return h.authorization
    })
    await expect(h.host.start(command, TASK_TEST_CALLER)).rejects.toThrow('FORBIDDEN')
    expect(admit).not.toHaveBeenCalled()
    expect(h.deps.store.get(command)).toBeNull()
    expect(h.deps.launch).not.toHaveBeenCalled()
  })

  it('rechecks the deadline inside queued admission before committing a receipt', async () => {
    const h = await taskDeadlineHostFixture()
    const command = taskCommand({ executionDeadlineAt: deadlineAt(1000) })
    const admit = h.deps.store.admit.bind(h.deps.store)
    vi.spyOn(h.deps.store, 'admit').mockImplementation(async (input) => {
      h.setNow(TASK_TEST_NOW + 1000)
      return admit(input)
    })
    await expect(h.host.start(command, TASK_TEST_CALLER)).rejects.toThrow('FORBIDDEN')
    expect(h.deps.store.get(command)).toBeNull()
    expect(h.deps.launch).not.toHaveBeenCalled()
  })

  it('fences a delayed spawn when its original deadline expires', async () => {
    const h = await taskDeadlineHostFixture()
    const command = taskCommand({ executionDeadlineAt: deadlineAt(1000) })
    const spawn = vi.fn()
    let release!: () => void
    let entered!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    h.deps.launch.mockImplementation(async (_record, authorization) => {
      entered()
      await held
      authorization.assertCurrent()
      spawn()
      throw new Error('Unexpected launch.')
    })
    await h.host.start(command, TASK_TEST_CALLER)
    await ready
    h.setNow(TASK_TEST_NOW + 1000)
    release()
    await h.host.drain()
    expect(spawn).not.toHaveBeenCalled()
    expect(h.deps.store.get(command)?.status).toBe('outcome_unknown')
    expect(h.deps.store.get(command)?.launch).toBeNull()
  })

  it('keeps observation, reconciliation and cancellation available after the execution deadline', async () => {
    const h = await taskDeadlineHostFixture()
    const command = taskCommand({ executionDeadlineAt: deadlineAt(1000) })
    const receipt = await h.host.start(command, TASK_TEST_CALLER)
    await h.host.drain()
    h.setNow(TASK_TEST_NOW + 1000)
    const { task, executionDeadlineAt, ...cancelIdentity } = {
      protocolVersion: command.protocolVersion,
      runtimeRecordId: command.runtimeRecordId,
      ownershipEpoch: command.ownershipEpoch,
      executionId: command.executionId,
      executionEpoch: command.executionEpoch,
      commandFingerprint: receipt.commandFingerprint,
      authorizationRef: command.authorizationRef,
      authorizationRevision: command.authorizationRevision,
      expiresAt: command.expiresAt,
      task: command.task,
      executionDeadlineAt: command.executionDeadlineAt
    }
    await expect(
      h.host.observe(
        { ...cancelIdentity, kind: 'execution.observe', afterSequence: 0, limit: 32 },
        TASK_TEST_CALLER
      )
    ).resolves.toMatchObject({ status: 'running' })
    await expect(
      h.host.reconcile({ ...cancelIdentity, kind: 'execution.reconcile' }, TASK_TEST_CALLER)
    ).resolves.toMatchObject({ status: 'running' })
    const cancel = {
      ...cancelIdentity,
      kind: 'execution.cancel',
      task,
      idempotencyKey: 'cancel:deadline',
      reason: 'user_requested'
    }
    expect(TaskExecutionCancelSchema.safeParse({ ...cancel, executionDeadlineAt }).success).toBe(
      false
    )
    await expect(h.host.cancel(cancel, TASK_TEST_CALLER)).resolves.toMatchObject({
      status: 'cancelled'
    })
  })
})
