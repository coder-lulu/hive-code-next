import { readHiveAgentConfirmedContext } from './hive-agent-confirmed-context'
import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import type { HiveAgentTextAdapter } from './hive-agent-text-adapter'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import { agentJournalTurnBody } from '../../shared/agent-session-turn-record'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'

export async function runHiveAgentGeneration(input: {
  entry: HiveAgentSessionEntry
  store: AgentSessionRecordStore
  journal: AgentSessionJournal
  adapter: HiveAgentTextAdapter
  callerKey: string
  text: string
  fingerprint: string
  fence: number
  signal: AbortSignal
  now: () => number
  authorize: () => void
  publish: () => void
}): Promise<void> {
  const { entry, store, journal } = input
  const { session, generation, turn } = entry.aggregate
  if (!generation || !turn || !generation.modelSelection || !generation.executionBinding) {
    throw new Error('hive_agent_invalid_request')
  }
  let sequence = 0
  let consumedEvents = 0
  let text = ''
  let textBytes = 0
  let persistedBytes = 0
  let fence = input.fence
  let execution: { assertCurrent: () => void } | undefined
  const canContinue = () => {
    input.authorize()
    execution?.assertCurrent()
    const current = store.hive.get(session.sessionId)?.aggregate.generation
    return (
      !input.signal.aborted &&
      current?.generationId === generation.generationId &&
      current.state === 'RUNNING'
    )
  }
  const flushText = async () => {
    if (textBytes === persistedBytes) {
      return
    }
    if (!canContinue()) {
      return
    }
    await journal.appendItem(
      { provider: 'orca', clientMessageId: `${generation.generationId}:assistant` },
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] },
      { fence, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
    )
    persistedBytes = textBytes
    if (canContinue()) {
      input.publish()
    }
  }
  const settle = (state: 'COMPLETED' | 'FAILED' | 'UNKNOWN') =>
    store.hive.settle({
      sessionId: session.sessionId,
      generationId: generation.generationId,
      callerKey: input.callerKey,
      operationId: turn.clientOperationId,
      state,
      now: input.now()
    })
  try {
    if (!canContinue()) {
      return
    }
    if (input.adapter.acquireExecution) {
      const acquired = await input.adapter.acquireExecution({
        sessionId: session.sessionId,
        generationId: generation.generationId,
        signal: input.signal
      })
      if (
        !Number.isSafeInteger(acquired.fence) ||
        acquired.fence < 1 ||
        typeof acquired.assertCurrent !== 'function'
      ) {
        throw new Error('hive_agent_outcome_unknown')
      }
      execution = acquired
      fence = acquired.fence
      if (!canContinue()) {
        return
      }
    }
    await journal.appendSubmission({
      clientMessageId: turn.clientOperationId,
      payloadFingerprint: input.fingerprint,
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: input.text }] },
      fence
    })
    if (!canContinue()) {
      return
    }
    input.publish()
    if (!canContinue()) {
      return
    }
    const history = readHiveAgentConfirmedContext(journal, input.text)
    for await (const event of input.adapter.run({
      sessionId: session.sessionId,
      generationId: generation.generationId,
      modelSelection: Object.freeze({ ...generation.modelSelection }),
      executionBinding: Object.freeze({ ...generation.executionBinding }),
      text: input.text,
      history,
      signal: input.signal
    })) {
      if (!canContinue()) {
        return
      }
      consumedEvents += 1
      if (consumedEvents > 1000) {
        throw new Error('event limit')
      }
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
        throw new Error('invalid sequence')
      }
      if (!['text', 'completed', 'failed'].includes(event.type)) {
        throw new Error('unsupported event')
      }
      if (event.sequence <= sequence) {
        continue
      }
      if (event.sequence !== sequence + 1 || event.sequence > 1000) {
        throw new Error('event gap or limit')
      }
      sequence = event.sequence
      if (sequence === 1) {
        await journal.resolveDispatch({
          clientMessageId: turn.clientOperationId,
          state: 'accepted',
          providerIdentity: { provider: 'orca', clientMessageId: turn.clientOperationId },
          fence
        })
        if (!canContinue()) {
          return
        }
      }
      if (event.type === 'text') {
        if (
          typeof event.text !== 'string' ||
          textBytes + Buffer.byteLength(event.text) > 1024 * 1024
        ) {
          throw new Error('output limit')
        }
        text += event.text
        textBytes += Buffer.byteLength(event.text)
        // Geometric checkpoints bound full-text write amplification independently of stream speed.
        if (persistedBytes === 0 || textBytes >= Math.max(1024, persistedBytes * 2)) {
          await flushText()
        }
      } else {
        await flushText()
        if (!canContinue()) {
          return
        }
        // Durable final evidence precedes aggregate settlement; restart never redispatches it.
        await journal.appendItem(
          { provider: 'orca', clientMessageId: `${generation.generationId}:receipt` },
          agentJournalTurnBody({
            turnId: turn.turnId,
            userItemId: agentJournalSubmissionKey(turn.clientOperationId),
            state: 'completed',
            outcome: event.type === 'completed' ? 'success' : 'failure',
            requestedAt: turn.createdAt,
            completedAt: input.now()
          }),
          { fence, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
        )
        if (!canContinue()) {
          return
        }
        await settle(event.type === 'completed' ? 'COMPLETED' : 'FAILED')
        input.authorize()
        input.publish()
        return
      }
    }
    if (!input.signal.aborted) {
      await flushText()
      await settle('UNKNOWN')
    }
  } catch {
    // Provider errors never become log/wire strings, and uncertain effects never replay.
    await settle('UNKNOWN')
  }
}
