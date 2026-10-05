import { AGENT_JOURNAL_THREAD_SCOPE } from '../../shared/agent-session-journal-types'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import { openAgentSessionJournal } from './agent-session-journal/journal-store-factory'
import { JournalHostDatabase } from './agent-session-journal/journal-host-database'
import { NO_LEGACY_JOURNAL_RECORDS } from './agent-session-journal/journal-database'
import { createAgentSessionCatchUpReader } from './agent-session-wire/agent-session-history-page'
import { AgentSessionSubscribers } from './agent-session-wire/structured-agent-session-subscribers'

it('reads/projects 1000 events within 200ms and drops a failed consumer without a queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-p2-budget-'))
  const database = await JournalHostDatabase.open(root, async () => NO_LEGACY_JOURNAL_RECORDS)
  const journal = await openAgentSessionJournal({
    database,
    identity: {
      sessionId: 'budget-session',
      workspaceId: 'folder-1',
      hostId: 'host-1',
      agent: 'pi',
      providerHandle: { kind: 'opaque', agent: 'pi', value: 'fixture' }
    }
  })
  try {
    for (let index = 0; index < 1000; index += 1) {
      await journal.appendItem(
        { provider: 'orca', clientMessageId: `event-${index}` },
        { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'x'.repeat(128) }] },
        { fence: 1, turnScope: AGENT_JOURNAL_THREAD_SCOPE }
      )
    }
    const samples: number[] = []
    let rssBefore = 0
    let heapBefore = 0
    for (let run = 0; run < 13; run += 1) {
      if (run === 3) {
        global.gc?.()
        rssBefore = process.memoryUsage().rss
        heapBefore = process.memoryUsage().heapUsed
      }
      const started = performance.now()
      const read = createAgentSessionCatchUpReader(journal)
      let cursor = { epoch: journal.epoch, sequence: 1 }
      let count = 0
      while (true) {
        const result = read({ sessionId: 'budget-session', direction: 'after', cursor, limit: 100 })
        if (!result.ok) {
          throw new Error('unexpected reset')
        }
        count += result.page.items.length
        cursor = result.page.window.nextCursor
        if (!result.page.hasNewer) {
          break
        }
      }
      if (run >= 3) {
        samples.push(performance.now() - started)
      }
      expect(count).toBe(1000)
    }
    expect(Math.max(...samples)).toBeLessThanOrEqual(200)
    global.gc?.()
    const rssAfter = process.memoryUsage().rss
    const heapAfter = process.memoryUsage().heapUsed
    expect(rssAfter).toBeLessThanOrEqual(rssBefore * 1.2)
    const subscribers = new AgentSessionSubscribers()
    let delivered = 0
    subscribers.open({
      id: 'slow',
      sessionId: 'budget-session',
      journal,
      fence: 1,
      emit: () => {
        delivered += 1
        throw new Error('transport full')
      }
    })
    subscribers.publish('budget-session', journal)
    expect(delivered).toBe(1)
    process.stdout.write(
      `HA-P2 bounded history evidence ${JSON.stringify({
        platform: process.platform,
        node: process.version,
        cpu: cpus()[0]?.model,
        totalMemory: totalmem(),
        events: 1000,
        textBytesPerEvent: 128,
        pageLimit: 100,
        samplesMs: samples,
        maxMs: Math.max(...samples),
        rssBefore,
        rssAfter,
        heapBefore,
        heapAfter,
        note: '3 warmups, GC before/after 10 measured samples; not a statistical SLO or long-run memory test'
      })}\n`
    )
  } finally {
    await journal.close()
    database.close()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
