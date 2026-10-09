import { afterEach, describe, expect, it, vi } from 'vitest'
import { dockerSessionFixture } from './task-docker-session-owner.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { recordingStructuredAgentSessionLogger } from '../native-chat/agent-session-wire/structured-agent-session-logger-test-support'
import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'

afterEach(closeTestJournalHostDatabases)
import { releaseStoredAgentSessionOwnerAfterSurfaceClose } from '../runtime/agent-session-surface-release-transition'
import {
  settleStructuredAgentSessionChildExit,
  type StructuredAgentSessionChildExitSession
} from '../native-chat/agent-session-wire/structured-agent-session-child-exit'

async function strippedFixture(live = true) {
  const f = await dockerSessionFixture(live)
  const record = { ...f.record() }
  delete record.taskSource
  await f.store.transitionHandoff(record.sessionId, () => record)
  expect(f.store.tasks.hasSessionBinding(record.sessionId)).toBe(true)
  return { ...f, record }
}
describe('original Task association after source loss', () => {
  it('refuses native surface release inside the original transaction', async () => {
    const f = await strippedFixture()
    await expect(
      releaseStoredAgentSessionOwnerAfterSurfaceClose(f.store, {
        sessionId: f.record.sessionId,
        expectedFence: f.record.lease.runtimeFence,
        now: TASK_TEST_NOW + 1000
      })
    ).rejects.toThrow('agent_session_ownership_unknown')
    expect(f.store.getRecord(f.record.sessionId)?.lease).toEqual(f.record.lease)
  })
  it.each(['root-exit-observed', 'exit-proven', 'processless', 'unproven'] as const)(
    'keeps a failed reservation with %s in unknown recovery',
    async (exitProof) => {
      const f = await strippedFixture(false)
      const token = f.record.lease.reservedSpawnToken
      if (!token) {
        throw new Error('original spawn token missing')
      }
      const next = await f.store.settleFailedAcquisition({
        sessionId: f.record.sessionId,
        fence: f.record.lease.runtimeFence,
        spawnToken: token,
        callerKey: f.request.operation.callerKey,
        operationId: f.request.operation.operationId,
        outcome: {
          status: 'failed',
          code: 'agent_session_operation_invalid',
          message: 'offline failed attach'
        },
        exitProof,
        now: TASK_TEST_NOW + 1000
      })
      expect(next.lease).toMatchObject({
        runtimeFence: f.record.lease.runtimeFence,
        reservedSpawnToken: token,
        claimStatus: 'reserved',
        handoffStage: 'recovering',
        deathEvidence: null
      })
    }
  )
  it('keeps failed post-acquisition attachment bound to its actual writer', async () => {
    const f = await strippedFixture()
    const token = f.record.lease.reservedSpawnToken
    if (!token) {
      throw new Error('original spawn token missing')
    }
    const next = await f.store.settleFailedPostAcquisitionAttachment({
      sessionId: f.record.sessionId,
      fence: f.record.lease.runtimeFence,
      spawnToken: token,
      callerKey: f.request.operation.callerKey,
      operationId: f.request.operation.operationId,
      outcome: {
        status: 'failed',
        code: 'agent_session_operation_invalid',
        message: 'offline failed publish'
      },
      exitProof: 'root-exit-observed',
      now: TASK_TEST_NOW + 1000
    })
    expect(next.lease).toMatchObject({
      runtimeFence: f.record.lease.runtimeFence,
      ownerProcess: f.record.lease.ownerProcess,
      reservedSpawnToken: token,
      claimStatus: 'live',
      handoffStage: 'recovering',
      deathEvidence: null
    })
  })
  it.each(['stripped', 'unreadable', 'became_visible'] as const)(
    'does not publish a new fence or root death on an unexpected CLI exit with a %s record',
    async (mode) => {
      const f = await strippedFixture()
      const session: StructuredAgentSessionChildExitSession = {
        child: {
          generation: 'offline-generation',
          fence: f.record.lease.runtimeFence,
          phase: 'ready'
        },
        journal: {
          cursor: () => ({ epoch: 'offline-epoch', sequence: 0 }),
          itemBody: () => null,
          itemFence: () => undefined,
          snapshot: () => ({ items: [] }),
          appendLifecycleBatch: vi.fn(async () => ({ epoch: 'offline-epoch', sequence: 1 })),
          markPendingSubmissionsUnknown: vi.fn(async () => []),
          rejectPendingSubmissions: vi.fn(async () => [])
        }
      }
      const publishFence = vi.fn()
      let associationVisible = mode !== 'became_visible'
      const store = {
        getRecord: mode === 'unreadable' ? () => null : f.store.getRecord,
        transitionHandoff: f.store.transitionHandoff.bind(f.store),
        tasks: {
          hasSessionBinding: (sessionId: string) =>
            associationVisible && f.store.tasks.hasSessionBinding(sessionId)
        }
      }
      await settleStructuredAgentSessionChildExit(
        {
          logger: recordingStructuredAgentSessionLogger().logger,
          store,
          sessions: new Map([[f.record.sessionId, session]]),
          flushLifecycle: async () => {
            associationVisible = true
            return { ok: true }
          },
          publishFence,
          serialize: async (_sessionId, task) => task(),
          now: () => TASK_TEST_NOW + 1000
        },
        {
          type: 'ended',
          sessionId: f.record.sessionId,
          fence: f.record.lease.runtimeFence,
          acquisitionGeneration: 'offline-generation',
          cause: 'unexpected-exit',
          reason: 'offline CLI exited'
        }
      )
      expect(f.store.getRecord(f.record.sessionId)?.lease).toMatchObject({
        runtimeFence: f.record.lease.runtimeFence,
        ownerProcess: f.record.lease.ownerProcess,
        handoffStage: mode === 'unreadable' ? null : 'recovering',
        deathEvidence: null
      })
      expect(session.lastEndedChild?.rootGone).toBe(false)
      expect(publishFence).not.toHaveBeenCalled()
    }
  )
})
