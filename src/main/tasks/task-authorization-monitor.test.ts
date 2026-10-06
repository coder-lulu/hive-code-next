import { rm } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openTestAgentSessionRecordStore } from '../runtime/agent-session-record-store-test-harness'
import { closeTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
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
    await closeTestJournalHostDatabase(directory)
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
      validUntil: TASK_TEST_NOW + 60_000,
      actions: ['start' as const],
      input: 'task',
      assertCurrent: () => {
        if (revoked) {
          throw new Error('FORBIDDEN')
        }
      }
    }
    const stop = vi.fn(async () => undefined),
      unsubscribe = vi.fn()
    monitor = installTaskAuthorizationMonitor({
      store: store.tasks,
      host: { cancelRevokedExecution: stop },
      issuer: {
        issuedBindings: () => [
          {
            bindingRef: 'binding:test',
            paperclipCompanyId: 'company:test',
            paperclipAgentId: 'agent:test',
            command,
            commandFingerprint: record.commandFingerprint
          }
        ],
        resolveGrant: () => grant
      },
      subscribe: () => unsubscribe,
      assertCurrent: () => undefined
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
