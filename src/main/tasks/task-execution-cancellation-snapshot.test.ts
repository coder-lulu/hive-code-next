import { mkdir, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeTaskExecutionFingerprint } from '../../shared/task-execution/task-execution-fingerprint'
import {
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore,
  readPersistedTestAgentSessionStore
} from '../runtime/agent-session-record-store-test-harness'
import { taskAdapterFixture } from './task-adapter.test-fixture'
import { TaskExecutionError } from './task-execution-error'
import { TaskExecutionRecordSchema, taskExecutionRecordKey } from './task-execution-record'
import * as fixturePorts from './task-execution.test-fixture'

let fixture: Awaited<ReturnType<typeof taskAdapterFixture>> | undefined
afterEach(async () => {
  await fixture?.close()
  fixture = undefined
  vi.restoreAllMocks()
})

describe('HTTP cancellation preserves the authorized immutable Task snapshot', () => {
  it.each(['ownershipEpoch', 'operationCallerKey', 'canonicalPath'])(
    'cannot persist an old cancellation onto a valid fresh %s replacement',
    async (changed) => {
      const evidenceRoot = resolve(
        'logs/paperclip-development/p3/task-startup-cancellation-proof/cancellation-cas-writer/tmp'
      )
      await mkdir(evidenceRoot, { recursive: true })
      vi.spyOn(fixturePorts, 'taskTestDirectory').mockImplementation(() =>
        mkdtemp(join(evidenceRoot, 'cancellation-snapshot-'))
      )
      fixture = await taskAdapterFixture()
      const current = fixture
      const admitted = await current.store.tasks.admit({
        command: current.binding.command,
        operationCallerKey: fixturePorts.TASK_TEST_CALLER.operationCallerKey,
        workspace: fixturePorts.taskWorkspace(current.directory),
        now: fixturePorts.TASK_TEST_NOW,
        validate: () => undefined
      })
      expect(admitted.created).toBe(true)
      const original = admitted.record
      const key = taskExecutionRecordKey(original.command)
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const authorize = vi.mocked(current.deps.authorize).getMockImplementation()!
      vi.spyOn(current.deps, 'authorize').mockImplementation(async (...args) => {
        const authorization = await authorize(...args)
        expect(args[2]).toBe('cancel')
        expect(args[1]).toEqual(original.command)
        entered.resolve()
        await release.promise
        return authorization
      })
      const cancellation = current.client
        .cancel({
          ...current.query,
          kind: 'execution.cancel',
          task: original.command.task,
          idempotencyKey: 'cancel:old-authorized-snapshot',
          reason: 'user_requested'
        })
        .then(
          () => null,
          (error: unknown) => error
        )
      try {
        await entered.promise
        const command = {
          ...original.command,
          ownershipEpoch: original.command.ownershipEpoch + (changed === 'ownershipEpoch' ? 1 : 0)
        }
        const operationCallerKey =
          changed === 'operationCallerKey' ? 'service:replacement' : original.operationCallerKey
        const commandFingerprint = computeTaskExecutionFingerprint(command, operationCallerKey)
        const replacement = TaskExecutionRecordSchema.parse({
          ...original,
          command,
          operationCallerKey,
          commandFingerprint,
          workspace: {
            ...original.workspace,
            canonicalPath:
              changed === 'canonicalPath'
                ? join(current.directory, 'replacement')
                : original.workspace.canonicalPath
          },
          accepted: {
            ...original.accepted,
            ownershipEpoch: command.ownershipEpoch,
            commandFingerprint,
            receiptId: `accepted:${commandFingerprint}`
          },
          events: original.events.map((event) => ({
            ...event,
            ownershipEpoch: command.ownershipEpoch,
            commandFingerprint,
            eventId: `event:${commandFingerprint}:${event.sequence}`
          }))
        })
        expect(replacement).not.toEqual(original)
        expect(taskExecutionRecordKey(replacement.command)).toBe(key)
        await editPersistedTestAgentSessionStore(current.directory, (persisted) => {
          persisted.taskExecutions[key] = replacement
        })
        release.resolve()
        const error = await cancellation
        const persisted = await readPersistedTestAgentSessionStore(current.directory)
        const reopened = await openTestAgentSessionRecordStore(current.directory)
        const records = [
          current.store.tasks.get(replacement.command),
          persisted.taskExecutions[key],
          reopened.tasks.get(replacement.command)
        ]
        // A conflict alone is insufficient: the old request must not write cancellation first.
        expect(records.map((record) => record?.cancellationKey)).toEqual([null, null, null])
        expect(records.map((record) => record?.result)).toEqual([null, null, null])
        expect(records).toEqual([replacement, replacement, replacement])
        expect(error).toBeInstanceOf(TaskExecutionError)
        expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
        expect(persisted.records).toEqual({})
        expect(persisted.operations).toEqual({})
        expect(current.deps.launch).not.toHaveBeenCalled()
        expect(current.deps.collect).not.toHaveBeenCalled()
        expect(current.deps.stop).not.toHaveBeenCalled()
      } finally {
        release.resolve()
        await cancellation
      }
    }
  )
})
