import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { agentJournalSubmissionKey } from '../../shared/agent-session-journal-item-key'
import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type { AgentSessionJournal } from './agent-session-journal/journal-store'
import { readHiveAgentConfirmedContext } from './hive-agent-confirmed-context'

function fixture(count = 1) {
  const snapshot: AgentJournalSnapshot = {
    sessionId: 'session',
    cursor: { epoch: 'epoch', sequence: count * 3 },
    items: [],
    submissions: []
  }
  for (let i = 0; i < count; i++) {
    const generation = `ha-generation:${randomUUID()}`
    const operation = `${1800000000000 + i}-${randomUUID().replaceAll('-', '')}`
    const key = agentJournalSubmissionKey(operation)
    snapshot.submissions.push({
      clientMessageId: operation,
      fence: 1,
      payloadFingerprint: 'fingerprint',
      dispatchState: 'accepted',
      providerItemId: key,
      reason: null,
      submittedAt: 1,
      resolvedAt: 2
    })
    snapshot.items.push(
      {
        itemId: key,
        revision: 1,
        sequence: i * 3 + 1,
        observedAt: 1,
        body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: `question ${i}` }] }
      },
      {
        itemId: agentJournalSubmissionKey(`${generation}:assistant`),
        revision: 1,
        sequence: i * 3 + 2,
        observedAt: 2,
        body: {
          kind: 'message',
          role: 'assistant',
          blocks: [{ type: 'text', text: `answer ${i}` }]
        }
      },
      {
        itemId: agentJournalSubmissionKey(`${generation}:receipt`),
        revision: 1,
        sequence: i * 3 + 3,
        observedAt: 3,
        body: {
          kind: 'turn',
          turnId: `ha-turn:${randomUUID()}`,
          userItemId: key,
          state: 'completed',
          outcome: 'success'
        }
      }
    )
  }
  const journal = { snapshot: () => snapshot, isReadOnly: false } as AgentSessionJournal
  return { snapshot, journal }
}

it('keeps recent complete pairs in chronological order within the message budget', () => {
  const f = fixture(40)
  const history = readHiveAgentConfirmedContext(f.journal, 'next')
  expect(history).toHaveLength(62)
  expect(history[0]).toEqual({ role: 'user', text: 'question 9' })
  expect(history.at(-1)).toEqual({ role: 'assistant', text: 'answer 39' })
})
it.each([
  'missing-receipt',
  'missing-answer',
  'failed',
  'unknown',
  'not-accepted',
  'recovered',
  'wrong-key',
  'late-edit',
  'mixed-blocks'
])('excludes incomplete or unconfirmed evidence: %s', (scenario) => {
  const f = fixture()
  const [user, assistant, receipt] = f.snapshot.items
  if (scenario === 'missing-receipt') {
    f.snapshot.items.pop()
  }
  if (scenario === 'missing-answer') {
    f.snapshot.items.splice(1, 1)
  }
  if (scenario === 'failed' && receipt.body.kind === 'turn') {
    receipt.body.outcome = 'failure'
  }
  if (scenario === 'unknown' && receipt.body.kind === 'turn') {
    delete receipt.body.outcome
  }
  if (scenario === 'not-accepted') {
    f.snapshot.submissions[0].dispatchState = 'unknown'
  }
  if (scenario === 'recovered') {
    user.recovered = true
  }
  if (scenario === 'wrong-key') {
    receipt.itemId = agentJournalSubmissionKey('not-generation:receipt')
  }
  if (scenario === 'late-edit') {
    assistant.sequence = 4
  }
  if (scenario === 'mixed-blocks' && assistant.body.kind === 'message') {
    assistant.body.blocks.push({ type: 'text', text: 'extra' })
  }
  expect(readHiveAgentConfirmedContext(f.journal, 'next')).toEqual([])
})
it('does not clip an oversized answer or drop the current user input', () => {
  const f = fixture(2)
  const answer = f.snapshot.items[4].body
  if (answer.kind !== 'message') {
    throw new Error('fixture')
  }
  answer.blocks = [{ type: 'text', text: '汉'.repeat(4000) }]
  expect(readHiveAgentConfirmedContext(f.journal, 'next')).toEqual([])
  expect(() => readHiveAgentConfirmedContext(f.journal, '汉'.repeat(4001))).toThrow()
})
