import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireOwner } from '../native-chat/agent-session-wire/structured-agent-session-acquisition'
import { taskCodexRuntimeFixture } from './task-codex-runtime.test-fixture'
import { taskDockerModelProfile } from './task-docker-model-profile'
import { modelStartParams } from './task-model-broker.test-fixture'
import { TASK_TEST_NOW } from './task-execution.test-fixture'
import { TASK_MODEL_RPC_START } from './task-model-channel-protocol'

let fixture: Awaited<ReturnType<typeof taskCodexRuntimeFixture>> | undefined
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(TASK_TEST_NOW)
})
afterEach(async () => {
  fixture?.docker.keepLive(false)
  await fixture?.adapter.closeAll()
  vi.restoreAllMocks()
  fixture = undefined
})

async function prepare() {
  fixture = await taskCodexRuntimeFixture()
  await acquireOwner(fixture.flow, fixture.record)
  const raw = fixture.codex.connections[0]
  if (!raw?.handlers.onServerRequest) {
    throw new Error('original Task model port missing')
  }
  const send = () => {
    const profile = taskDockerModelProfile()
    raw.handlers.onServerRequest?.({
      id: `hive-model-${randomUUID()}-0`,
      method: TASK_MODEL_RPC_START,
      params: modelStartParams({
        model: profile.model,
        input: [
          { type: 'additional_tools', role: 'developer', tools: profile.approvedTools },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Write report.' }]
          }
        ],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { effort: 'low', context: 'all_turns' },
        store: false,
        stream: true,
        include: ['reasoning.encrypted_content']
      })
    })
  }
  return { f: fixture, raw, send }
}

describe('actual controlled Runtime execution budget', () => {
  it('uses the live source guard after the original RPC expiry, within the execution budget', async () => {
    const { f, send } = await prepare()
    vi.mocked(Date.now).mockReturnValue(Date.parse(f.command.expiresAt) + 1)
    send()
    await vi.waitFor(() => expect(f.readAuth).toHaveBeenCalledOnce())
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts).toBe(1)
    expect(f.nativeOpen).not.toHaveBeenCalled()
  })

  it('refuses model effects after the original accepted execution exhausts its total budget', async () => {
    const { f, raw, send } = await prepare()
    vi.mocked(Date.now).mockReturnValue(TASK_TEST_NOW + 30 * 60_000)
    send()
    await vi.waitFor(() => expect(raw.closeCount).toBe(1))
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.store.tasks.get(f.command)?.modelDispatchAttempts ?? 0).toBe(0)
  })

  it('rechecks revoked source authority even though the total execution budget remains', async () => {
    const { f, raw, send } = await prepare()
    vi.mocked(Date.now).mockReturnValue(Date.parse(f.command.expiresAt) + 1)
    f.validate.mockImplementation(() => {
      throw new Error('source-revoked')
    })
    send()
    await vi.waitFor(() => expect(raw.closeCount).toBe(1))
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })
})
