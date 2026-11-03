import { CODEX_STRUCTURED_AGENT } from '../../codex/codex-structured-agent-definition'
import { StructuredAgentRegistry } from './structured-agent-registry'
import { NO_STRUCTURED_AGENTS } from './structured-agent-session-adapter-router-test-support'

/** Exercise Codex option intent without declaring unsupported provider operations. */
export const CONVERSATION_STOP_TEST_AGENTS = new StructuredAgentRegistry(
  NO_STRUCTURED_AGENTS.registrations().map((registration) =>
    registration.definition.agent === 'codex'
      ? {
          ...registration,
          definition: {
            ...registration.definition,
            restingOptions: CODEX_STRUCTURED_AGENT.restingOptions
          }
        }
      : registration
  )
)

import { describe, expect, it, type Mock } from 'vitest'
import type { StructuredAgentSessionHost } from './structured-agent-session-host'
import type { StructuredAgentSessionAdapter } from './structured-agent-session-adapter'
import type { StructuredAgentSessionEventSink } from './structured-agent-session-event-sink'
import type { AgentSessionRecordStore } from '../../runtime/agent-session-record-store'
import type { AgentJournalSubmission } from '../../../shared/agent-session-journal-types'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
import {
  HOST_TEST_SESSION as SESSION,
  hostTestOperationId
} from './structured-agent-session-host-test-data'

type StopLifecycleContext = {
  current: () => {
    host: StructuredAgentSessionHost
    store: AgentSessionRecordStore
    events: StructuredAgentSessionEventSink | undefined
    cancelTurn: Mock<StructuredAgentSessionAdapter['cancelTurn']>
    closeSession: Mock<NonNullable<StructuredAgentSessionAdapter['closeSession']>>
  }
  send: (text: string) => { id: string; result: Promise<unknown> }
  stop: (turnId?: string, operationId?: string, drain?: boolean) => Promise<unknown>
  submission: (id: string) => Promise<AgentJournalSubmission | undefined>
  statusRows: () => Promise<string[]>
  laneDrained: () => Promise<void>
  eventually: (assertion: () => void | Promise<void>) => Promise<void>
}

/** Shared hooks remain in the suite; these cases distinguish durable acceptance from shutdown. */
export function registerSessionEndingStopTests({
  current,
  send,
  stop,
  submission,
  statusRows,
  laneDrained,
  eventually
}: StopLifecycleContext): void {
  describe('a Stop on a provider whose Stop ends its session', () => {
    it('commits acceptance and its request note before queued shutdown completes', async () => {
      await handedOver()
      const closing = Promise.withResolvers<boolean>()
      current().closeSession.mockImplementationOnce(() => closing.promise)
      const operationId = hostTestOperationId()
      expect(await stop(undefined, operationId, false)).toMatchObject({
        ok: true,
        value: { cancelled: true }
      })
      await eventually(() => expect(current().closeSession).toHaveBeenCalledOnce())
      const journal = current().host.collaboratorsForTests().sessions.get(SESSION)!.journal
      expect(
        journal
          .snapshot()
          .items.filter((item) => item.body.kind === 'status')
          .map((item) => item.body)
      ).toEqual([expect.objectContaining({ text: 'Cancellation requested.' })])
      expect(current().host.collaboratorsForTests().sessions.get(SESSION)?.child).toBeTruthy()
      closing.resolve(true)
      await laneDrained()
      // A retry acknowledges the original receipt and performs no new cancellation.
      expect(await stop(undefined, operationId, false)).toMatchObject({
        ok: true,
        replayed: true,
        value: { cancelled: false }
      })
      expect(current().closeSession).toHaveBeenCalledOnce()

      expect(current().host.collaboratorsForTests().sessions.get(SESSION)?.child).toBeNull()
      expect(current().store.getRecord(SESSION)?.lease.claimStatus).toBe('released')
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })

    async function handedOver(): Promise<void> {
      const { id, result } = send('hello')
      await result
      await eventually(async () => expect((await submission(id))?.handedOverAt).toBeDefined())
    }

    it('ends the child after the cancel even when the provider refused it, and says only that it was asked', async () => {
      await handedOver()
      current().cancelTurn.mockResolvedValueOnce({
        cancelled: false,
        refusal: { detail: { text: 'no active turn to interrupt', audience: 'person' } }
      })

      expect(await stop()).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().closeSession).toHaveBeenCalledWith(SESSION, expect.any(Function))
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })

    it('ends the child and says it was asked when the provider declined a Stop naming the live turn', async () => {
      await handedOver()
      current().events!.appendItem(
        { provider: 'legacy', agent: 'codex', sessionId: SESSION, recordId: 'turn:turn-1' },
        { kind: 'turn', turnId: 'turn-1', state: 'running' },
        { turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
      await current().host.flushStreamedEvents(SESSION)
      current().cancelTurn.mockResolvedValueOnce({ cancelled: false })

      expect(await stop('turn-1')).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().closeSession).toHaveBeenCalledWith(SESSION, expect.any(Function))
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })

    it('closes the captured child after an accepted session Stop', async () => {
      await handedOver()
      current().cancelTurn.mockResolvedValueOnce({ cancelled: true })

      expect(await stop()).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().closeSession).toHaveBeenCalledExactlyOnceWith(SESSION, expect.any(Function))
    })

    it('closes the captured session when a named turn is no longer live', async () => {
      // Handed over, with no row yet for the turn it names: the Stop reaches the provider.
      await handedOver()
      current().cancelTurn.mockResolvedValueOnce({ cancelled: false })

      expect(await stop('turn-1')).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().cancelTurn).toHaveBeenCalledWith(
        expect.objectContaining({ turnId: 'turn-1' })
      )
      expect(current().closeSession).toHaveBeenCalledExactlyOnceWith(SESSION, expect.any(Function))
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })

    it("ends the child when the provider's cancel of a Stop naming a turn no longer live fails", async () => {
      await handedOver()
      // The interrupt went out and its answer was lost: what it stopped is unknown.
      current().cancelTurn.mockRejectedValueOnce(new Error('control request lost'))

      expect(await stop('turn-1')).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().closeSession).toHaveBeenCalledWith(SESSION, expect.any(Function))
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })

    it('ends the child when the provider took a Stop naming a turn that is no longer live', async () => {
      await handedOver()
      current().cancelTurn.mockResolvedValueOnce({ cancelled: true })

      expect(await stop('turn-1')).toMatchObject({ ok: true, value: { cancelled: true } })
      await laneDrained()

      expect(current().closeSession).toHaveBeenCalledWith(SESSION, expect.any(Function))
      expect(await statusRows()).toEqual(['Cancellation requested.'])
    })
  })
}

export async function conversationStopStatusRows(
  host: StructuredAgentSessionHost
): Promise<string[]> {
  return (await host.journalSnapshot(SESSION)).items.flatMap((item) =>
    item.body.kind === 'status' ? [item.body.text] : []
  )
}
