import type { HiveAgentSessionEntry } from '../../shared/hive-agent-session-entry'
import type { AgentSessionRecordStore } from '../runtime/agent-session-record-store'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import type { HiveAgentTextAdapter } from './hive-agent-text-adapter'

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
  if (!generation || !turn) {
    throw new Error('hive_agent_invalid_request')
  }
  let sequence = 0
  let consumedEvents = 0
  let text = ''
  let textBytes = 0
  let persistedBytes = 0
  const flushText = async () => {
    if (textBytes === persistedBytes) {
      return
    }
    input.authorize()
    const current = store.hive.get(session.sessionId)?.aggregate.generation
    if (
      input.signal.aborted ||
      current?.generationId !== generation.generationId ||
      current.state !== 'RUNNING'
    ) {
      return
    }
    await journal.appendItem(
      { provider: 'orca', clientMessageId: `${generation.generationId}:assistant` },
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] },
      { fence: input.fence }
    )
    persistedBytes = textBytes
    input.publish()
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
    input.authorize()
    await journal.appendSubmission({
      clientMessageId: turn.clientOperationId,
      payloadFingerprint: input.fingerprint,
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: input.text }] },
      fence: input.fence
    })
    input.publish()
    input.authorize()
    if (input.signal.aborted) {
      return
    }
    for await (const event of input.adapter.run({
      sessionId: session.sessionId,
      generationId: generation.generationId,
      text: input.text,
      signal: input.signal
    })) {
      input.authorize()
      const current = store.hive.get(session.sessionId)?.aggregate.generation
      if (
        input.signal.aborted ||
        current?.generationId !== generation.generationId ||
        current.state !== 'RUNNING'
      ) {
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
          fence: input.fence
        })
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
        // Durable final evidence precedes aggregate settlement; restart never redispatches it.
        await journal.appendItem(
          { provider: 'orca', clientMessageId: `${generation.generationId}:receipt` },
          {
            kind: 'message',
            role: 'system',
            blocks: [{ type: 'text', text: event.type === 'completed' ? 'COMPLETED' : 'FAILED' }]
          },
          { fence: input.fence }
        )
        await settle(event.type === 'completed' ? 'COMPLETED' : 'FAILED')
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
