import { closeTestJournalHostDatabases } from '../native-chat/agent-session-journal/journal-host-database-test-support'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskModelStreamFetchFixture } from './task-model-stream-fetch.test-fixture'
import {
  controlledTaskModelResponseStream,
  controlledTaskModelRequest
} from './task-model-response-envelope.test-fixture'
import { responseFieldProvenanceCases } from './task-model-response-field-provenance.test-fixture'
import { finishModelRequest } from './task-model-broker.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { readPersistedTestAgentSessionStore } from '../runtime/agent-session-record-store-test-harness'
import { taskFailureSummary, type TaskFailureError } from './task-failure-diagnostic'

let directory: string
const fixtures: Awaited<ReturnType<typeof createTaskModelStreamFetchFixture>>[] = []
beforeEach(async () => {
  const root = resolve('logs/paperclip-development/p3/task-response-field-provenance/author/tmp')
  await mkdir(root, { recursive: true })
  directory = await mkdtemp(join(root, 'provenance-'))
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async ({ channel, server }) => {
      await channel.close()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
    })
  )
  vi.restoreAllMocks()
  closeTestJournalHostDatabases()
  await rm(directory, { recursive: true, force: true })
})
async function fixture(response: Record<string, unknown>) {
  const body = controlledTaskModelResponseStream(response)
  const f = await createTaskModelStreamFetchFixture(directory, body)
  fixtures.push(f)
  f.params.bodyBase64 = controlledTaskModelRequest(f.params.bodyBase64)
  return { ...f, body }
}

describe('original isolated Task/global Fetch response field provenance', () => {
  it.each(responseFieldProvenanceCases)(
    'persists only the actual $label location/key while refusing the frame',
    async ({ response, location, reason, key }) => {
      const f = await fixture(response)
      const before = f.owner.store.tasks.get(f.owner.command)!
      const session = f.owner.store.getRecord(f.owner.binding.sessionId)
      const failed = vi.fn<(error: TaskFailureError) => void>()
      f.channel.onFailure(failed)
      await f.channel.start(f.params)
      const emitted: Buffer[] = []
      await expect(
        (async () => {
          for (let sequence = 0; sequence < 128; sequence++) {
            const value = await f.channel.next({ requestId: f.params.requestId, sequence })
            emitted.push(Buffer.from(value.bodyBase64, 'base64'))
            if (value.done) {
              throw new Error('Refused synthetic frame completed')
            }
          }
        })()
      ).rejects.toMatchObject({
        diagnostic: {
          streamReason: 'policy',
          policyReason: reason,
          policyLocation: location,
          ...(key ? { policyKey: key } : {})
        }
      })
      expect(Buffer.concat(emitted).length).toBe(0)
      await f.channel.close()
      const late = vi.fn<(error: TaskFailureError) => void>()
      f.channel.onFailure(late)
      await new Promise<void>((done) => queueMicrotask(done))
      expect(late.mock.calls[0][0]).toBe(failed.mock.calls[0][0])
      const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
      expect(task.events.at(-1)?.summary).toBe(taskFailureSummary('model', failed.mock.calls[0][0]))
      expect(JSON.stringify(task.events)).not.toMatch(/private-key|body-token-secret|unapproved/)
      expect(task).toMatchObject({
        status: before.status,
        dispatch: before.dispatch,
        result: null,
        structuredBinding: before.structuredBinding,
        cancellationKey: before.cancellationKey,
        workspace: before.workspace,
        modelDispatchAttempts: 1
      })
      expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
      expect(f.request).toHaveBeenCalledOnce()
    }
  )

  it('retains identical admitted bytes, original session and absence of outcome evidence', async () => {
    const f = await fixture({})
    const before = f.owner.store.tasks.get(f.owner.command)!
    const session = f.owner.store.getRecord(f.owner.binding.sessionId)
    await f.channel.start(f.params)
    expect(await finishModelRequest(f.channel, f.params.requestId)).toBe(f.body)
    await f.channel.close()
    const task = (await readPersistedTestAgentSessionStore(directory)).taskExecutions[f.owner.key]
    expect(task.events).toEqual(before.events)
    expect(task.result).toBeNull()
    expect(task.modelDispatchAttempts).toBe(1)
    expect(f.owner.store.getRecord(f.owner.binding.sessionId)).toEqual(session)
  })
})
