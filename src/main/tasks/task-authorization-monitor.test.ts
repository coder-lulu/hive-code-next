import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import type { TaskExecutionRecord } from './task-execution-record'
import { installTaskAuthorizationMonitor } from './task-authorization-monitor'
import {
  taskCommand,
  taskTestDirectory,
  taskWorkspace,
  TASK_TEST_CALLER,
  TASK_TEST_NOW
} from './task-execution.test-fixture'

let directory = ''
let monitor: ReturnType<typeof installTaskAuthorizationMonitor> | undefined
afterEach(async () => {
  await monitor?.close()
  if (directory) {
    await rm(directory, { recursive: true, force: true })
  }
})
describe('issued task authorization monitoring', () => {
  it('stops only the admitted execution after its live grant is revoked', async () => {
    directory = await taskTestDirectory()
    const store = await openTestAgentSessionRecordStore(directory)
    const command = taskCommand(),
      workspace = taskWorkspace(directory)
    const record = (
      await store.tasks.admit({
        command,
        workspace,
        operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
        now: TASK_TEST_NOW,
        validate: () => undefined
      })
    ).record
    let revoked = false
    const grant = {
      command,
      workspace,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
      accountId: 'account',
      authorityId: 'authority',
      sessionGeneration: 1,
      runtimeOwnershipEpoch: command.ownershipEpoch,
      validUntil: TASK_TEST_NOW + 60_000,
      actions: ['start' as const],
      input: 'task',
      assertCurrent: () => {
        if (revoked) {
          throw new Error('FORBIDDEN')
        }
      }
    }
    const stop = vi.fn(
        async (_record: typeof record, _caller: typeof TASK_TEST_CALLER) => undefined
      ),
      unsubscribe = vi.fn()
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: {
        fenceRevokedExecution: async () => undefined,
        recoverPersistedExecution: async (current, caller, _fingerprint, assertAuthorized) => {
          try {
            assertAuthorized()
          } catch {
            await stop(current, caller)
          }
        }
      },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: () => grant.assertCurrent(),
        launchFingerprint: () => 'original-launch'
      },
      subscribe: () => unsubscribe,
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    await monitor.check()
    expect(stop).not.toHaveBeenCalled()
    revoked = true
    await monitor.check()
    expect(stop).toHaveBeenCalledWith(
      expect.objectContaining({ command }),
      expect.objectContaining(TASK_TEST_CALLER)
    )
    await monitor.close()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

function gate() {
  let release!: () => void
  let started!: () => void
  const ready = new Promise<void>((resolve) => {
    started = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    ready,
    release,
    hold: async () => {
      started()
      await held
    }
  }
}

async function admitRecords(count: number) {
  directory = await taskTestDirectory()
  const store = await openTestAgentSessionRecordStore(directory)
  const records: TaskExecutionRecord[] = []
  for (let index = 0; index < count; index++) {
    const seed = `${index}`
    const command = taskCommand({
      executionId: `execution:${seed}`,
      operationId: `${TASK_TEST_NOW}-${index.toString(16).padStart(32, '0')}`,
      idempotencyKey: `start:${seed}`,
      workspaceExecutionClaimRef: `claim:${seed}`,
      task: { ...taskCommand().task, taskId: `task:${seed}`, runId: `run:${seed}` }
    })
    records.push(
      (
        await store.tasks.admit({
          command,
          workspace: {
            ...taskWorkspace(directory),
            workspaceId: `workspace:${seed}`,
            executionPath: `${directory}/execution-${seed}`
          },
          operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
          now: TASK_TEST_NOW,
          validate: () => undefined
        })
      ).record
    )
  }
  return { store, records }
}

describe('persisted task authorization monitoring', () => {
  it('finds executions committed by another process after its store was opened', async () => {
    directory = await taskTestDirectory()
    const reader = await openTestAgentSessionRecordStore(directory)
    const writer = await openTestAgentSessionRecordStore(directory)
    const { record } = await writer.tasks.admit({
      command: taskCommand(),
      workspace: taskWorkspace(directory),
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey,
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
    const recover = vi.fn(async () => undefined)
    monitor = installTaskAuthorizationMonitor({
      store: reader.tasks,
      host: { recoverPersistedExecution: recover, fenceRevokedExecution: async () => undefined },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: () => undefined,
        launchFingerprint: () => 'original-launch'
      },
      subscribe: () => () => undefined,
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    await monitor.check()
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({ command: record.command }),
      expect.objectContaining(TASK_TEST_CALLER),
      'original-launch',
      expect.any(Function)
    )
  })
  it('persists revocation while another execution is blocked collecting its outcome', async () => {
    const { store, records } = await admitRecords(2)
    const blocked = gate()
    let revoked = false
    let notify!: () => void
    const fence = vi.fn(async (record: TaskExecutionRecord) => {
      await store.tasks.requestCancellation(
        record.command,
        `revoked:${record.commandFingerprint}`,
        TASK_TEST_NOW,
        () => undefined
      )
    })
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: {
        fenceRevokedExecution: fence,
        recoverPersistedExecution: async (record) => {
          if (record.command.executionId === records[0].command.executionId) {
            await blocked.hold()
          }
        }
      },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: (record) => {
          if (revoked && record.command.executionId === records[1].command.executionId) {
            throw new Error('FORBIDDEN')
          }
        },
        launchFingerprint: () => 'original-launch'
      },
      subscribe: (listener) => {
        notify = listener
        return () => undefined
      },
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    try {
      await blocked.ready
      revoked = true
      notify()
      await vi.waitFor(() => expect(fence).toHaveBeenCalled())
      await vi.waitFor(() =>
        expect(store.tasks.get(records[1].command)?.cancellationKey).toBe(
          `revoked:${records[1].commandFingerprint}`
        )
      )
      expect(store.tasks.get(records[0].command)?.cancellationKey).toBeNull()
    } finally {
      blocked.release()
      await monitor.check()
    }
  })
  it('bounds concurrent recovery while letting independent executions make progress', async () => {
    const { store } = await admitRecords(9)
    const blocked = gate()
    let active = 0,
      peak = 0
    const recover = vi.fn(async (_record: TaskExecutionRecord) => {
      active++
      peak = Math.max(peak, active)
      try {
        await blocked.hold()
      } finally {
        active--
      }
    })
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: { recoverPersistedExecution: recover, fenceRevokedExecution: async () => undefined },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: () => undefined,
        launchFingerprint: () => 'original-launch'
      },
      subscribe: () => () => undefined,
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    const recovering = monitor.check()
    try {
      await blocked.ready
      await vi.waitFor(() => expect(peak).toBe(4))
      expect(recover).toHaveBeenCalledTimes(4)
    } finally {
      blocked.release()
      await recovering
    }
    expect(recover).toHaveBeenCalledTimes(9)
    expect(peak).toBe(4)
  })
  it('never fences or recovers an execution belonging to another caller', async () => {
    const { store } = await admitRecords(1)
    await store.tasks.admit({
      command: taskCommand({
        executionId: 'execution:foreign',
        operationId: `${TASK_TEST_NOW}-${'f'.repeat(32)}`,
        idempotencyKey: 'start:foreign',
        task: { ...taskCommand().task, taskId: 'task:foreign', runId: 'run:foreign' },
        workspaceExecutionClaimRef: 'claim:foreign'
      }),
      workspace: {
        ...taskWorkspace(directory),
        workspaceId: 'workspace:foreign',
        executionPath: `${directory}/foreign`
      },
      operationCallerKey: 'foreign:caller',
      now: TASK_TEST_NOW,
      validate: () => undefined
    })
    const recover = vi.fn(async (_record: TaskExecutionRecord) => undefined),
      fence = vi.fn(async (_record: TaskExecutionRecord) => undefined)
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: { recoverPersistedExecution: recover, fenceRevokedExecution: fence },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: () => {
          throw new Error('FORBIDDEN')
        },
        launchFingerprint: () => null
      },
      subscribe: () => () => undefined,
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    await monitor.check()
    expect(recover).toHaveBeenCalledOnce()
    expect(fence).toHaveBeenCalled()
    expect(
      fence.mock.calls.every(
        ([record]) => record.operationCallerKey === TASK_TEST_CALLER.operationCallerKey
      )
    ).toBe(true)
    expect(recover.mock.calls[0][0].operationCallerKey).toBe(TASK_TEST_CALLER.operationCallerKey)
  })
  it('drains started recovery and prevents more work once the monitor closes', async () => {
    const { store } = await admitRecords(7)
    const blocked = gate()
    const recover = vi.fn(async () => blocked.hold()),
      unsubscribe = vi.fn()
    let notify!: () => void
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: { recoverPersistedExecution: recover, fenceRevokedExecution: async () => undefined },
      issuer: {
        restoreBindings: async () => ({ restored: 0, unavailable: 0 }),
        assertExecutionCurrent: () => undefined,
        launchFingerprint: () => null
      },
      subscribe: (listener) => {
        notify = listener
        return unsubscribe
      },
      assertCurrent: () => undefined,
      operationCallerKey: TASK_TEST_CALLER.operationCallerKey
    })
    await blocked.ready
    const closing = monitor.close()
    const count = recover.mock.calls.length
    notify()
    blocked.release()
    await closing
    await monitor.check()
    expect(recover).toHaveBeenCalledTimes(count)
    expect(unsubscribe).toHaveBeenCalledOnce()
    await monitor.close()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
