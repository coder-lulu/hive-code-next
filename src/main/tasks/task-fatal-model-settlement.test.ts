import { afterEach, describe, expect, it, vi } from 'vitest'
import { fatalModelFixture } from './task-fatal-model-settlement.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  closeTestJournalHostDatabases,
  closeTestJournalHostDatabase
} from '../native-chat/agent-session-journal/journal-host-database-test-support'
import {
  readPersistedTestAgentSessionStore,
  editPersistedTestAgentSessionStore,
  openTestAgentSessionRecordStore
} from '../runtime/agent-session-record-store-test-harness'
import { taskExecutionRecordKey } from './task-execution-record'
import { readTaskModelFatalFailure } from './task-model-fatal-failure'
import { taskFailure } from './task-failure-diagnostic'
import { abandonStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host-test-abandon'

const fixtures: Awaited<ReturnType<typeof fatalModelFixture>>[] = []
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    f.allowStop()
    await f.connection.close()
    await f.taskHost.drain()
    await f.host.flushAllStreamedEvents()
  }
  setStructuredAgentSessionHost(null)
  closeTestJournalHostDatabases()
  vi.restoreAllMocks()
})
async function fixture() {
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
  const f = await fatalModelFixture()
  fixtures.push(f)
  return f
}
describe('original fatal model lifecycle without user cancellation', () => {
  it('bounds automatic attempts and remains unknown when no stop is proven', async () => {
    const f = await fixture()
    await f.fatal()
    await vi.waitFor(() => expect(f.stopBoundary).toHaveBeenCalledTimes(4), { timeout: 2500 })
    await new Promise<void>((done) => setTimeout(done, 300))
    expect(f.stopBoundary).toHaveBeenCalledTimes(4)
    expect(f.onExit).not.toHaveBeenCalled()
    expect((await f.reconcile()).result).toBeNull()
    expect(f.store.tasks.get(f.command)?.status).toBe('outcome_unknown')
    expect(f.record().lease.deathEvidence).toBeNull()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts).toBe(1)
  })
  it('automatically retries an unproven close and reports only the original failure', async () => {
    const f = await fixture()
    const failure = await f.fatal()
    expect(f.onExit).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    f.allowStop()
    await vi.waitFor(() => expect(f.onExit).toHaveBeenCalledExactlyOnceWith(failure), {
      timeout: 2000
    })
    expect(f.stopBoundary.mock.calls.length).toBeGreaterThan(1)
    await expect(f.channel.start({ ...f.params, requestId: f.requestId })).rejects.toThrow()
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts).toBe(1)
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.launchAgain).not.toHaveBeenCalled()
  })
  it('reconciles unknown until exact host stop, then settles failed without a completed turn', async () => {
    const f = await fixture()
    await f.fatal()
    const failureEvent = f.store.tasks.get(f.command)!.events.at(-1)
    expect((await f.reconcile()).result).toBeNull()
    expect(f.store.tasks.get(f.command)?.status).toBe('outcome_unknown')
    expect(f.record().lease.deathEvidence).toBeNull()
    f.allowStop()
    const observation = await f.reconcile()
    expect(observation.result).toMatchObject({
      status: 'failed',
      artifactRefs: [],
      usageFactRefs: [],
      stopProof: { evidenceKind: 'stopped', managedToolsSettled: true, writersFenced: true }
    })
    const task = f.store.tasks.get(f.command)!
    expect(task.cancellationKey).toBeNull()
    expect(task.structuredBinding).toEqual(f.original.structuredBinding)
    expect(task.command).toEqual(f.original.command)
    expect(task.workspace).toEqual(f.original.workspace)
    expect(task.events).toContainEqual(failureEvent)
    expect(task.modelDispatchAttempts).toBe(1)
    expect(f.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
    expect(f.host.hasSession(f.binding.sessionId)).toBe(false)
    expect(
      (await readPersistedTestAgentSessionStore(f.directory)).taskExecutions[
        taskExecutionRecordKey(f.command)
      ]
    ).toEqual(task)
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.acquire).not.toHaveBeenCalled()
    expect(f.launchAgain).not.toHaveBeenCalled()
    expect(readTaskModelFatalFailure(f.store.tasks, task)).toBeUndefined()
  })

  it('keeps first private failure, clears a proved retry timer and never revives a terminal fact', async () => {
    const f = await fixture()
    const first = await f.fatal()
    expect(readTaskModelFatalFailure(f.store.tasks, f.store.tasks.get(f.command)!)).toBe(first)
    await f.store.tasks.recordModelFailure(
      f.original,
      taskFailure(undefined, 'stream', 'TASK_MODEL_IDLE_TIMEOUT', 200),
      TASK_TEST_NOW
    )
    expect(readTaskModelFatalFailure(f.store.tasks, f.store.tasks.get(f.command)!)).toBe(first)
    f.allowStop()
    await f.reconcile()
    const attempts = f.stopBoundary.mock.calls.length
    await new Promise<void>((done) => setTimeout(done, 300))
    expect(f.stopBoundary).toHaveBeenCalledTimes(attempts)
    const install = vi.fn()
    await f.store.tasks.runRecordedModelFailureEffect(f.original, install)
    expect(install).not.toHaveBeenCalled()
    expect(readTaskModelFatalFailure(f.store.tasks, f.store.tasks.get(f.command)!)).toBeUndefined()
  })

  it('never reconstructs a fatal fact from diagnostic appearance, transport JSON or a reopened store', async () => {
    const f = await fixture()
    await f.store.tasks.recordModelFailure(
      f.original,
      taskFailure(
        new Error('TASK_MODEL_STREAM_REFUSED'),
        'stream',
        'TASK_MODEL_STREAM_REFUSED',
        200
      ),
      TASK_TEST_NOW
    )
    expect((await f.reconcile()).result).toBeNull()
    expect(f.stopBoundary).not.toHaveBeenCalled()
    expect(
      readTaskModelFatalFailure(f.store.tasks, structuredClone(f.store.tasks.get(f.command)!))
    ).toBeUndefined()
    expect(f.request).not.toHaveBeenCalled()
    const other = await fixture()
    await other.fatal()
    const current = other.store.tasks.get(other.command)!
    await abandonStructuredAgentSessionHost(other.host)
    closeTestJournalHostDatabase(other.directory)
    const cold = await openTestAgentSessionRecordStore(other.directory)
    expect(cold.tasks.get(other.command)).toEqual(current)
    expect(readTaskModelFatalFailure(cold.tasks, current)).toBeUndefined()
    Object.defineProperty(other.host.deps, 'store', { value: cold })
    expect(await other.evidence.collect(current)).toBeNull()
    expect(cold.tasks.get(other.command)?.result).toBeNull()
  })

  it.each(['epoch', 'binding', 'session', 'recovery'] as const)(
    'refuses %s drift before terminal settlement',
    async (field) => {
      const f = await fixture()
      await f.fatal()
      if (field === 'epoch') {
        const foreign = structuredClone(f.store.tasks.get(f.command)!)
        foreign.command.executionEpoch++
        expect(readTaskModelFatalFailure(f.store.tasks, foreign)).toBeUndefined()
      } else {
        await editPersistedTestAgentSessionStore(f.directory, (state) => {
          if (field === 'binding') {
            state.taskExecutions[
              taskExecutionRecordKey(f.command)
            ]!.structuredBinding!.accountHome.path = '/foreign-home'
          } else if (field === 'recovery') {
            Object.defineProperty(state, 'taskRecoveryBlocked', { value: true, enumerable: true })
          }
        })
        if (field === 'session') {
          await f.store.transitionHandoff(f.binding.sessionId, (record) => ({
            ...record,
            lease: { ...record.lease, unreconciled: true }
          }))
        }
        await f.store.tasks.readActive(() => undefined)
        await expect(f.evidence.collect(f.store.tasks.get(f.command)!)).rejects.toThrow(
          /OUTCOME_UNKNOWN|IDEMPOTENCY_CONFLICT/
        )
        await editPersistedTestAgentSessionStore(f.directory, (state) => {
          state.taskExecutions[taskExecutionRecordKey(f.command)]!.structuredBinding =
            structuredClone(f.binding)
          state.records[f.binding.sessionId]!.lease.unreconciled = false
          Object.defineProperty(state, 'taskRecoveryBlocked', { value: false, enumerable: true })
        })
        await f.store.tasks.readActive(() => undefined)
        if (field === 'session') {
          await f.store.transitionHandoff(f.binding.sessionId, (record) => ({
            ...record,
            lease: { ...record.lease, unreconciled: false }
          }))
        }
      }
      expect(f.store.tasks.get(f.command)?.result).toBeNull()
      expect(f.onExit).not.toHaveBeenCalled()
      expect(f.request).toHaveBeenCalledOnce()
    }
  )

  it('lets cancellation win after collection and before the positive stop commit', async () => {
    const f = await fixture()
    await f.fatal()
    f.allowStop()
    f.disposeSession.mockImplementationOnce(async () => {
      await f.store.tasks.requestCancellation(
        f.command,
        'cancel:fatal-race',
        TASK_TEST_NOW,
        f.validate
      )
      return f.connection.close()
    })
    expect((await f.reconcile()).result).toMatchObject({
      status: 'cancelled',
      stopProof: { evidenceKind: 'stopped' }
    })
    expect(f.store.tasks.get(f.command)?.cancellationKey).toBe('cancel:fatal-race')
    expect(f.request).toHaveBeenCalledOnce()
    expect(f.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
  })

  it('does not install a late fact when cancellation wins the post-persistence lock', async () => {
    const f = await fixture()
    const install = f.store.tasks.runRecordedModelFailureEffect.bind(f.store.tasks)
    vi.spyOn(f.store.tasks, 'runRecordedModelFailureEffect').mockImplementationOnce(
      async (...args) => {
        await f.store.tasks.requestCancellation(
          f.command,
          'cancel:before-fact',
          TASK_TEST_NOW,
          f.validate
        )
        return install(...args)
      }
    )
    await f.fatal()
    expect(readTaskModelFatalFailure(f.store.tasks, f.store.tasks.get(f.command)!)).toBeUndefined()
    expect(f.store.tasks.get(f.command)?.cancellationKey).toBe('cancel:before-fact')
    expect(f.store.tasks.get(f.command)?.result).toBeNull()
    expect(f.request).toHaveBeenCalledOnce()
  })
})
