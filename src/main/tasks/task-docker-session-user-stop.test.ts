import { describe, expect, it, vi } from 'vitest'
import { codexProviderHandle } from '../../shared/agent-session-provider-handle-encoding'
import { StructuredAgentSessionHostRuntimeState } from '../native-chat/agent-session-wire/structured-agent-session-host-runtime-state'
import { openTestJournalHostDatabase } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { openAgentSessionJournal } from '../native-chat/agent-session-journal/journal-store-factory'
import type { StructuredAgentSessionAdapter } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostDeps,
  StructuredAgentSessionHostSession
} from '../native-chat/agent-session-wire/structured-agent-session-host-types'
import {
  stopStructuredAgentSessionAgentUnderSerialize,
  type StructuredAgentSessionLifetimeContext
} from '../native-chat/agent-session-wire/structured-agent-session-host-lifetime'
import {
  endExitedStructuredAgentSessionChildUnderSerialize,
  settleStructuredAgentSessionChildExit
} from '../native-chat/agent-session-wire/structured-agent-session-child-exit'
import { NO_STRUCTURED_AGENTS } from '../native-chat/agent-session-wire/structured-agent-session-adapter-router-test-support'
import { createTaskDockerSessionOwner } from './task-docker-session-owner'
import { dockerSessionFixture, dockerOwnerRunner } from './task-docker-session-owner.test-fixture'
import { recordingStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'

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

async function lifetimeFixture(stopProven = true) {
  const fixture = await dockerSessionFixture()
  const runner = dockerOwnerRunner(fixture)
  if (!stopProven) {
    runner.keepLive()
  }
  const owner = createTaskDockerSessionOwner({ store: fixture.store, run: runner.run })
  const record = fixture.record()
  const journalDatabase = openTestJournalHostDatabase(fixture.directory)
  const journal = await openAgentSessionJournal({
    database: journalDatabase,
    identity: {
      sessionId: record.sessionId,
      workspaceId: record.location.workspaceId,
      hostId: 'local',
      agent: 'codex',
      providerHandle: codexProviderHandle('thread-docker')
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
  const sessions = new Map([[record.sessionId, session]])
  const deps: StructuredAgentSessionHostDeps = {
    logger: recordingStructuredAgentSessionLogger().logger,
    store: fixture.store,
    adapter: adapter(),
    agents: NO_STRUCTURED_AGENTS,
    claimKeyId: 'claim-key-one',
    journalDatabase,
    stopExecutionOwner: owner.stop,
    probeOwner: async (value) => (await owner.probe(value)) ?? { outcome: 'reservation-unused' }
  }
  const runtimeState = new StructuredAgentSessionHostRuntimeState(deps, sessions)
  const publishStatus = vi.fn(() => {
    expect(fixture.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
    expect(session.child).toBeNull()
  })
  const exitContext = {
    logger: deps.logger,
    store: fixture.store,
    sessions,
    now: () => record.updatedAt + 1000,
    flushLifecycle: (sessionId: string) => runtimeState.lifecycleBarrier(sessionId),
    publishFence: vi.fn(),
    publishStatus,
    serialize: async <T>(_id: string, task: () => Promise<T>) => task()
  }
  const endExitedChild = vi.fn<StructuredAgentSessionLifetimeContext['endExitedChild']>(
    (sessionId, child, exit) =>
      endExitedStructuredAgentSessionChildUnderSerialize(exitContext, sessionId, child, exit)
  )
  const context: StructuredAgentSessionLifetimeContext = {
    deps,
    runtimeState,
    sessions,
    now: exitContext.now,
    publishStatus,
    endExitedChild
  }
  return {
    fixture,
    record,
    session,
    context,
    exitContext,
    endExitedChild,
    publishStatus,
    close: async () => {
      await journal.close()
      journalDatabase.close()
    }
  }
}

describe('Task user stop through the active child lifecycle', () => {
  it('aborts before child end and publication if CID stop is unavailable despite CLI close success', async () => {
    const f = await lifetimeFixture()
    f.context.deps.stopExecutionOwner = async () => {
      throw new Error('exact CID exit unproven')
    }
    try {
      await expect(
        stopStructuredAgentSessionAgentUnderSerialize(f.context, f.record.sessionId, {
          recorded: 'user-stop'
        })
      ).rejects.toThrow('exact CID exit unproven')
      expect(f.endExitedChild).not.toHaveBeenCalled()
      expect(f.session.child).not.toBeNull()
      expect(f.fixture.record().lease.runtimeFence).toBe(1)
      expect(f.fixture.record().lease.deathEvidence).toBeNull()
      expect(f.publishStatus).not.toHaveBeenCalled()
    } finally {
      await f.close()
    }
  })

  it('commits CID death before child end/publication and repeats the same stop without another fence', async () => {
    const f = await lifetimeFixture()
    const observed: string[] = []
    f.endExitedChild.mockImplementation(async (sessionId, child, exit) => {
      expect(f.fixture.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
      expect(f.fixture.record().lease.runtimeFence).toBe(2)
      expect(f.session.child).toBe(child)
      observed.push('death-committed')
      await endExitedStructuredAgentSessionChildUnderSerialize(
        f.exitContext,
        sessionId,
        child,
        exit
      )
      observed.push('child-ended')
    })
    f.publishStatus.mockImplementation(() => {
      expect(f.fixture.record().lease.deathEvidence?.kind).toBe('execution-host-exit-observed')
      expect(f.session.child).toBeNull()
      observed.push('published')
    })
    try {
      await stopStructuredAgentSessionAgentUnderSerialize(f.context, f.record.sessionId, {
        recorded: 'user-stop'
      })
      expect(observed).toEqual(['death-committed', 'published', 'child-ended'])
      expect(f.fixture.record().lease.runtimeFence).toBe(2)
      expect(await f.context.runtimeState.commitExecutionOwnerStop(f.record.sessionId, 1)).toBe(
        'resolved'
      )
      expect(f.fixture.record().lease.runtimeFence).toBe(2)
    } finally {
      await f.close()
    }
  })

  it.each([true, false])(
    'original journal/lifetime stop commits only when CID stop=%s',
    async (stopProven) => {
      const f = await lifetimeFixture(stopProven)
      try {
        await f.session.journal.appendStopEvent(
          { reason: 'user-stop' },
          f.record.lease.runtimeFence
        )
        const stopping = () =>
          stopStructuredAgentSessionAgentUnderSerialize(f.context, f.record.sessionId, {
            recorded: 'user-stop'
          })
        if (stopProven) {
          await stopping()
          expect(f.session.child).toBeNull()
          expect(f.session.lastEndedChild?.rootGone).toBe(true)
          expect(f.fixture.record().lease.runtimeFence).toBe(2)
          expect(f.publishStatus).toHaveBeenCalledOnce()
          await stopping()
          expect(f.fixture.record().lease.runtimeFence).toBe(2)
        } else {
          await expect(stopping()).rejects.toThrow('stop-provider-child')
          expect(f.session.child?.close?.cause).toBe('user-stop')
          expect(f.fixture.record().lease.deathEvidence).toBeNull()
          expect(f.fixture.record().lease.runtimeFence).toBe(1)
          expect(f.publishStatus).not.toHaveBeenCalled()
        }
      } finally {
        await f.close()
      }
    }
  )

  it('does not release or report writer death when only the Task CLI unexpectedly exits', async () => {
    const f = await lifetimeFixture()
    try {
      await settleStructuredAgentSessionChildExit(
        { ...f.exitContext, publishStatus: undefined },
        {
          type: 'ended',
          sessionId: f.record.sessionId,
          cause: 'unexpected-exit',
          fence: 1,
          acquisitionGeneration: 'generation-task-one',
          reason: 'CLI exited'
        }
      )
      expect(f.session.lastEndedChild?.rootGone).toBe(false)
      expect(f.fixture.record().lease).toMatchObject({
        runtimeFence: 1,
        handoffStage: 'recovering',
        deathEvidence: null
      })
      expect(f.exitContext.publishFence).not.toHaveBeenCalled()
    } finally {
      await f.close()
    }
  })
})
