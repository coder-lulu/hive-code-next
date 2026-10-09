import { codexProviderHandle } from '../../../shared/agent-session-provider-handle-encoding'
import { AGENT_JOURNAL_THREAD_SCOPE } from '../../../shared/agent-session-journal-types'
// Per-chat close drains admitted writes and refuses new work. The shared host
// database remains open for other chats and closes only at host teardown.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalItemIdentity,
  AgentSessionJournalIdentity
} from '../../../shared/agent-session-journal-types'
import { agentSessionFailureFact } from '../../../shared/agent-session-failure'
import { agentSessionFailureWords } from '../../../shared/agent-session-failure-words'
import type { AgentSessionJournal } from './journal-store'
import {
  createTrackedJournalOpener,
  openTestJournalHostDatabase
} from './journal-host-database-test-support'
import { journalDatabasePath } from './journal-host-database'

const IDENTITY: AgentSessionJournalIdentity = {
  sessionId: 'session-1',
  workspaceId: 'ws-1',
  hostId: 'host-1',
  agent: 'codex',
  providerHandle: codexProviderHandle('thread-1')
}

let root: string
const journals = createTrackedJournalOpener()

function item(ordinal: number): AgentJournalItemIdentity {
  return { provider: 'codex', threadId: 'thread-1', turnId: 'turn-1', ordinal }
}

function body(value: string): AgentJournalItemBody {
  return { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: value }] }
}

function openJournal(): Promise<AgentSessionJournal> {
  return journals.open({ identity: IDENTITY, stateDirectory: root })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orca-journal-close-'))
})

afterEach(async () => {
  await journals.closeAll()
  await rm(root, { recursive: true, force: true })
})

describe('closed-state admission happens at enqueue', () => {
  it('completes a write enqueued in the same turn as the close', async () => {
    const journal = await openJournal()
    const append = journal.appendItem(item(1), body('before'), {
      fence: 1,
      turnScope: AGENT_JOURNAL_THREAD_SCOPE
    })
    const closed = journal.close()

    await expect(append).resolves.toBeDefined()
    await expect(closed).resolves.toBeUndefined()
    const reopened = await openJournal()
    expect(reopened.snapshot().items).toHaveLength(1)
  })

  it('refuses a write offered while the close is still in flight, without queueing it', async () => {
    const journal = await openJournal()
    const closing = journal.close()
    const refused = journal.appendItem(item(1), body('during'), {
      fence: 1,
      turnScope: AGENT_JOURNAL_THREAD_SCOPE
    })

    // The rejection is available before the close step has run: it never joined
    // the queue, so nothing is ever chained behind a close.
    await expect(refused).rejects.toMatchObject({ code: 'journal_closed' })
    await expect(closing).resolves.toBeUndefined()
  })

  it('refuses every write entry point after the close has settled', async () => {
    const journal = await openJournal()
    await journal.close()
    const settle = (attempt: Promise<unknown>): Promise<unknown> =>
      attempt.then(
        () => new Error('resolved instead of refusing'),
        (error: unknown) => error
      )
    const refusals = [
      settle(
        journal.appendItem(item(1), body('after'), {
          fence: 1,
          turnScope: AGENT_JOURNAL_THREAD_SCOPE
        })
      ),
      settle(journal.appendTombstone(item(3), { fence: 1 })),
      settle(
        journal.appendSubmission({
          clientMessageId: 'cm_1',
          payloadFingerprint: 'f',
          body: { kind: 'message', role: 'user', blocks: [] },
          fence: 1
        })
      ),
      settle(
        journal.resolveDispatch({
          clientMessageId: 'cm_1',
          state: 'rejected',
          ...agentSessionFailureWords(agentSessionFailureFact('hostFault'), {
            surface: 'rejection'
          }),
          fence: 1
        })
      ),
      settle(
        journal.appendLifecycleBatch({
          settlementId: 'settle',
          fence: 1,
          mutations: [
            {
              kind: 'item',
              identity: item(4),
              body: body('x'),
              turnScope: AGENT_JOURNAL_THREAD_SCOPE
            }
          ]
        })
      ),
      settle(journal.rollEpoch('handle_forked', 1)),
      settle(journal.replaceEpochItems('handle_forked', 1, [])),
      settle(journal.purgeContent(1)),
      settle(
        journal.queuedMessages.insert({
          messageId: 'closed-draft',
          body: { kind: 'message', role: 'user', blocks: [] },
          fingerprint: 'closed-draft-fp',
          hostInstance: 'host-1'
        })
      )
    ]
    for (const refusal of refusals) {
      expect(await refusal).toMatchObject({ code: 'journal_closed' })
    }
  })

  // The property part 1 rests on: every entry point reaches the gate in the
  // caller's own turn, so a refusal never advances the queue.
  it('rejects without waiting for the queue to advance', async () => {
    const journal = await openJournal()
    const inFlight = journal.appendItem(item(1), body('admitted'), {
      fence: 1,
      turnScope: AGENT_JOURNAL_THREAD_SCOPE
    })
    const closing = journal.close()

    // Settles while the admitted append is still running: it reached the gate in
    // the caller's own turn and never joined the queue behind it.
    await expect(
      journal.appendItem(item(2), body('later'), {
        fence: 1,
        turnScope: AGENT_JOURNAL_THREAD_SCOPE
      })
    ).rejects.toMatchObject({
      code: 'journal_closed'
    })
    await expect(inFlight).resolves.toBeDefined()
    await expect(closing).resolves.toBeUndefined()
  })

  it('closing a chat drains its queue without closing the shared host database', async () => {
    const journal = await openJournal()
    const database = openTestJournalHostDatabase(root)
    await journal.close()
    await expect(journal.close()).resolves.toBeUndefined()
    expect(database.isClosed).toBe(false)
    const reopened = await openJournal()
    await expect(
      reopened.appendItem(item(2), body('next owner'), {
        fence: 1,
        turnScope: AGENT_JOURNAL_THREAD_SCOPE
      })
    ).resolves.toBeDefined()
  })

  it('purges only the owned chat including durable draft bodies and cached pause facts', async () => {
    const journal = await openJournal()
    const other = await journals.open({
      identity: { ...IDENTITY, sessionId: 'other-chat' },
      stateDirectory: root
    })
    await journal.appendItem(item(1), body('owned-purge-secret'), {
      fence: 1,
      turnScope: { kind: 'thread' }
    })
    await journal.queuedMessages.insert({
      messageId: 'own-draft',
      body: {
        kind: 'message',
        role: 'user',
        blocks: [{ type: 'text', text: 'owned-queued-secret' }]
      },
      fingerprint: 'own-fp',
      hostInstance: 'host-1'
    })
    await other.queuedMessages.insert({
      messageId: 'other-draft',
      body: { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'other-secret' }] },
      fingerprint: 'other-fp',
      hostInstance: 'host-1'
    })
    await journal.appendStopEvent({ reason: 'user-stop', caller: 'client-1' }, 1)
    expect(journal.queuedMessages.pauses('host-1')).toHaveLength(1)
    expect(journal.queuedMessages.list()).toHaveLength(1)
    const oldEpoch = journal.epoch
    await journal.purgeContent(1)
    expect(journal.epoch).not.toBe(oldEpoch)
    expect(journal.snapshot().items).toEqual([])
    expect(journal.queuedMessages.list()).toEqual([])
    expect(other.queuedMessages.list()).toHaveLength(1)
    // Stop/Resume are now folded journal facts; the replacement must retain no owned pause.
    expect(journal.queuedMessages.pauses('host-1')).toEqual([])
    const persisted = await readFile(journalDatabasePath(root))
    expect(persisted.includes(Buffer.from('owned-purge-secret'))).toBe(false)
    expect(persisted.includes(Buffer.from('owned-queued-secret'))).toBe(false)
    expect(persisted.includes(Buffer.from('other-secret'))).toBe(true)
  })

  it('retains the host connection after a failed close and releases it on retry', async () => {
    const journal = await openJournal()
    await journal.close()
    const database = openTestJournalHostDatabase(root)
    const connection = database.db
    const release = connection.close.bind(connection)
    let attempts = 0
    connection.close = () => {
      attempts += 1
      if (attempts === 1) {
        throw new Error('injected host release failure')
      }
      release()
    }
    expect(() => database.close()).toThrow('injected host release failure')
    expect(database.isClosed).toBe(false)
    database.close()
    expect(database.isClosed).toBe(true)
    database.close()
    expect(attempts).toBe(2)
  })
})
