import { describe, expect, it, vi } from 'vitest'
import { evictStructuredAgentSession } from '../native-chat/agent-session-wire/structured-agent-session-eviction'
import { createDeferredStructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import { StructuredAgentSessionHostRuntimeState } from '../native-chat/agent-session-wire/structured-agent-session-host-runtime-state'
import { openTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openAgentSessionJournal } from '../native-chat/agent-session-journal/journal-store-factory'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../native-chat/agent-session-wire/structured-agent-session-host-types'
import { stopStructuredAgentSessionAgentUnderSerialize } from '../native-chat/agent-session-wire/structured-agent-session-host-lifetime'
import { settleUnexpectedStructuredAgentSessionExit } from '../native-chat/agent-session-wire/structured-agent-session-unexpected-exit'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import { dockerSessionFixture, dockerOwnerRunner } from './task-docker-session-owner.test-fixture'
import {
  recordingStructuredAgentSessionLogger,
  testEventSinkLogging
} from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'

function adapter(): StructuredAgentSessionAdapter {
  return {
    acquire: vi.fn<StructuredAgentSessionAdapter['acquire']>(),
    dispatch: vi.fn<StructuredAgentSessionAdapter['dispatch']>(),
    cancelTurn: vi.fn<StructuredAgentSessionAdapter['cancelTurn']>(),
    answerPrompt: vi.fn<StructuredAgentSessionAdapter['answerPrompt']>(),
    setOption: vi.fn<StructuredAgentSessionAdapter['setOption']>(),
    closeSession: async () => true
  }
}

describe('Task user stop original eviction order', () => {
  it('aborts before end/release/publication if CID stop is unavailable despite CLI close success', async () => {
    const sink = createDeferredStructuredAgentSessionEventSink({
      ...testEventSinkLogging('session-task-one'),
      onFailed: () => undefined
    })
    const onProviderChildStopped = vi.fn()
    const releaseLease = vi.fn()
    const acknowledgeRelease = vi.fn()
    const context = {
      logger: recordingStructuredAgentSessionLogger().logger,
      sessionId: 'session-task-one',
      adapter: adapter(),
      eventSink: sink,
      hasProviderChild: true,
      discardSink: vi.fn(),
      releaseLease,
      acknowledgeRelease,
      onProviderChildStopped,
      stopExecutionOwner: async () => {
        throw new Error('exact CID exit unproven')
      }
    }
    await expect(evictStructuredAgentSession(context)).rejects.toThrow('stop-provider-child')
    expect(onProviderChildStopped).not.toHaveBeenCalled()
    expect(releaseLease).not.toHaveBeenCalled()
    expect(acknowledgeRelease).not.toHaveBeenCalled()
    sink.close()
  })
  it('commits CID death before end/publication and repeats the same stop without another fence', async () => {
    const fixture = await dockerSessionFixture()
    const runner = dockerOwnerRunner(fixture)
    const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
    const journalDatabase = openTestJournalHostDatabase(fixture.directory)
    const runtime = new StructuredAgentSessionHostRuntimeState({
      logger: recordingStructuredAgentSessionLogger().logger,
      store: fixture.store,
      adapter: adapter(),
      claimKeyId: 'claim-key-one',
      journalDatabase,
      probeOwner: async (record) =>
        (await owner.probe(record)) ?? { outcome: 'reservation-unused' },
      stopExecutionOwner: owner.stop
    })
    const sink = runtime.eventSinkFor(fixture.record().sessionId)
    const observed: string[] = []
    const context = {
      logger: recordingStructuredAgentSessionLogger().logger,
      sessionId: fixture.record().sessionId,
      adapter: adapter(),
      eventSink: sink,
      hasProviderChild: true,
      discardSink: () => undefined,
      releaseLease: async () => {
        observed.push('release')
      },
      acknowledgeRelease: () => {
        observed.push('publish')
      },
      onProviderChildStopped: () => {
        expect(fixture.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
        observed.push('child-ended')
      },
      stopExecutionOwner: async () => {
        expect(await runtime.commitExecutionOwnerStop(fixture.record().sessionId, 1)).toBe(
          'resolved'
        )
      }
    }
    await evictStructuredAgentSession(context)
    expect(observed).toEqual(['child-ended', 'release', 'publish'])
    expect(fixture.record().lease.runtimeFence).toBe(2)
    expect(await runtime.commitExecutionOwnerStop(fixture.record().sessionId, 1)).toBe('resolved')
    expect(fixture.record().lease.runtimeFence).toBe(2)
    journalDatabase.close()
  })
  it.each([true, false])(
    'original journal/lifetime stop commits only when CID stop=%s',
    async (stopProven) => {
      const fixture = await dockerSessionFixture()
      const runner = dockerOwnerRunner(fixture)
      if (!stopProven) {
        runner.keepLive()
      }
      const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
      const record = fixture.record()
      const journalDatabase = openTestJournalHostDatabase(fixture.directory)
      const deps: StructuredAgentSessionHostDeps = {
        logger: recordingStructuredAgentSessionLogger().logger,
        store: fixture.store,
        adapter: adapter(),
        claimKeyId: 'claim-key-one',
        journalDatabase,
        stopExecutionOwner: owner.stop,
        probeOwner: async (value) => (await owner.probe(value)) ?? { outcome: 'reservation-unused' }
      }
      const runtimeState = new StructuredAgentSessionHostRuntimeState(deps)
      const journal = await openAgentSessionJournal({
        database: journalDatabase,
        identity: {
          sessionId: record.sessionId,
          workspaceId: record.location.workspaceId,
          hostId: 'local',
          agent: 'codex',
          providerHandle: { kind: 'codex', threadId: 'thread-docker' }
        }
      })
      const session: StructuredAgentSessionHostSession = {
        journal,
        params: {
          envelope: {
            sessionId: record.sessionId,
            clientOperationId: fixture.request.operation.operationId,
            expectedRuntimeFence: 1,
            payloadFingerprint: fixture.request.operation.fingerprint
          },
          provider: 'codex',
          agent: 'codex',
          runtimeKind: 'native',
          location: record.location,
          accountHome: record.accountHome
        },
        child: { generation: 'generation-task-one', fence: 1, phase: 'ready' }
      }
      const publishStatus = vi.fn(() => {
        expect(fixture.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
      })
      const context = {
        deps,
        runtimeState,
        sessions: new Map([[record.sessionId, session]]),
        now: () => record.updatedAt + 1000,
        publishStatus
      }
      try {
        await journal.appendStopEvent({ reason: 'user-stop' }, record.lease.runtimeFence)
        if (stopProven) {
          await stopStructuredAgentSessionAgentUnderSerialize(context, record.sessionId, {
            recorded: 'user-stop'
          })
          expect(session.child).toBeNull()
          expect(session.owesProviderChildWindDown).toBeUndefined()
          expect(fixture.record().lease.runtimeFence).toBe(2)
          expect(publishStatus).toHaveBeenCalledOnce()
          await stopStructuredAgentSessionAgentUnderSerialize(context, record.sessionId, {
            recorded: 'user-stop'
          })
          expect(fixture.record().lease.runtimeFence).toBe(2)
        } else {
          await expect(
            stopStructuredAgentSessionAgentUnderSerialize(context, record.sessionId, {
              recorded: 'user-stop'
            })
          ).rejects.toThrow('stop-provider-child')
          expect(session.child).not.toBeNull()
          expect(fixture.record().lease.deathEvidence).toBeNull()
          expect(fixture.record().lease.runtimeFence).toBe(1)
          expect(publishStatus).not.toHaveBeenCalled()
        }
      } finally {
        await journal.close()
        journalDatabase.close()
      }
    }
  )
  it('does not release or report writer death when only the Task CLI unexpectedly exits', async () => {
    const fixture = await dockerSessionFixture()
    const record = fixture.record()
    const journalDatabase = openTestJournalHostDatabase(fixture.directory)
    const journal = await openAgentSessionJournal({
      database: journalDatabase,
      identity: {
        sessionId: record.sessionId,
        workspaceId: record.location.workspaceId,
        hostId: 'local',
        agent: 'codex',
        providerHandle: { kind: 'codex', threadId: 'thread-docker' }
      }
    })
    const session: StructuredAgentSessionHostSession = {
      journal,
      params: {
        envelope: {
          sessionId: record.sessionId,
          clientOperationId: fixture.request.operation.operationId,
          expectedRuntimeFence: 1,
          payloadFingerprint: fixture.request.operation.fingerprint
        },
        provider: 'codex',
        agent: 'codex',
        runtimeKind: 'native',
        location: record.location,
        accountHome: record.accountHome
      },
      child: { generation: 'generation-task-one', fence: 1, phase: 'ready' }
    }
    const publishFence = vi.fn()
    try {
      await settleUnexpectedStructuredAgentSessionExit(
        {
          logger: recordingStructuredAgentSessionLogger().logger,
          store: fixture.store,
          sessions: new Map([[record.sessionId, session]]),
          now: () => record.updatedAt + 1000,
          flushLifecycle: async () => ({ ok: true }),
          publishFence,
          serialize: async (_id, task) => task()
        },
        {
          type: 'ended',
          sessionId: record.sessionId,
          cause: 'unexpected-exit',
          fence: 1,
          acquisitionGeneration: 'generation-task-one',
          reason: 'CLI exited'
        }
      )
      expect(session.lastEndedChild?.rootGone).toBe(false)
      expect(fixture.record().lease).toMatchObject({
        runtimeFence: 1,
        handoffStage: 'recovering',
        deathEvidence: null
      })
      expect(publishFence).not.toHaveBeenCalled()
    } finally {
      await journal.close()
      journalDatabase.close()
    }
  })
})
