import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { NativeTeamTaskToolSession } from '../../shared/hive-team-task-tools'
import type { StructuredAgentSessionEventSink } from '../native-chat/agent-session-wire/structured-agent-session-event-sink'
import {
  adapterFor,
  fakeCodex,
  identityFor,
  THREAD_ID,
  USER_MESSAGE
} from './codex-structured-session-adapter-fixture'
import { CodexAppServerRequestError } from './codex-app-server-connection'
import { prepareCodexTeamTaskTools } from './codex-team-task-tool-host'
import { teamToolFixture } from '../tasks/hive-team-task-tools.test-fixture'
import { randomUUID } from 'node:crypto'
import { agentJournalItemKey } from '../../shared/agent-session-journal-item-key'
import type { AgentJournalItemBody } from '../../shared/agent-session-journal-types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(options: { resume?: boolean; bound?: boolean; sink?: boolean } = {}) {
  const codex = fakeCodex()
  const tools: NativeTeamTaskToolSession = {
    definitions: ['hive_team_task_start', 'hive_team_task_status'].map((name) => ({
      name,
      description: 'Team task',
      inputSchema: { type: 'object', additionalProperties: false }
    })),
    bindThread: vi.fn(async () => options.bound !== false),
    call: vi.fn(async (_call, guard) => {
      guard()
      return { success: true, value: { caseId: 'case-1' } }
    })
  }
  const bodies = new Map<string, AgentJournalItemBody>()
  const sink: StructuredAgentSessionEventSink = {
    appendItem: vi.fn(),
    appendTombstone: vi.fn(),
    publish: vi.fn(),
    tryAppendItem: vi.fn((identity, body) => {
      bodies.set(agentJournalItemKey(identity), body)
      return { accepted: true as const }
    }),
    tryPublish: vi.fn(() => ({ accepted: true as const })),
    written: vi.fn(async () => ({ ok: true as const })),
    journalLinkage: () => ({
      epoch: 'epoch',
      visitItemsWithLinkage: vi.fn(),
      itemBody: (id) => bodies.get(id) ?? null
    })
  }
  const adapter = adapterFor(codex, options.resume ? { resumeThreadId: THREAD_ID } : {}, [], {
    prepareTeamTaskTools: async () => tools
  })
  const acquire = () =>
    adapter.acquire({
      identity: identityFor('session-1'),
      fence: 7,
      spawnToken: 'spawn-9',
      ...(options.sink === false ? {} : { events: sink })
    })
  await acquire()
  const connection = codex.connections[0]
  const notify = (method: string, turnId = 'turn-1', threadId = THREAD_ID) =>
    connection.handlers.onNotification?.(method, {
      threadId,
      turn: { id: turnId, status: 'completed' }
    })
  notify('turn/started')
  let sequence = 0
  const request = (patch: Record<string, unknown> = {}, id: number | string = ++sequence) => {
    connection.handlers.onServerRequest?.({
      id,
      method: 'item/tool/call',
      params: {
        threadId: THREAD_ID,
        turnId: 'turn-1',
        callId: `call-${sequence}`,
        tool: 'hive_team_task_start',
        arguments: { requirement: 'Work' },
        ...patch
      }
    })
    return id
  }
  const reply = async (id: number | string) => {
    await vi.waitFor(() => expect(connection.replies.some((entry) => entry.id === id)).toBe(true))
    return z
      .object({
        success: z.boolean(),
        contentItems: z.array(z.object({ type: z.literal('inputText'), text: z.string() }))
      })
      .parse(connection.replies.find((entry) => entry.id === id)?.result)
  }
  return { codex, tools, sink, adapter, acquire, connection, notify, request, reply, bodies }
}

describe('Codex team task dynamic tool bridge', () => {
  it('retries a premature interrupt after the revoked opening turn starts without permitting tools', async () => {
    const f = await fixture()
    f.notify('turn/completed')
    const interrupt = deferred<object>()
    let attempts = 0
    f.codex.routes['turn/start'] = () => ({ turn: { id: 'retry-opening' } })
    f.codex.routes['turn/interrupt'] = () => {
      if (++attempts === 1) {
        throw new CodexAppServerRequestError(
          'turn/interrupt',
          -32600,
          'codex request refused',
          'no active turn to interrupt'
        )
      }
      return interrupt.promise
    }
    await f.adapter.dispatch({
      sessionId: 'session-1',
      fence: 7,
      clientMessageId: 'retry-send',
      body: USER_MESSAGE
    })
    const stopped = f.adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    f.notify('turn/started', 'retry-opening')
    expect((await f.reply(f.request({ turnId: 'retry-opening' }))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    interrupt.resolve({})
    expect(await stopped).toMatchObject({ cancelled: true, turnId: 'retry-opening' })
    expect(attempts).toBe(2)
    await f.adapter.closeAll()
  })
  it('revokes the default Stop opening target before turn/started and interrupt ACK', async () => {
    const f = await fixture()
    f.notify('turn/completed')
    const interrupt = deferred<object>()
    f.codex.routes['turn/start'] = () => ({ turn: { id: 'opening-turn' } })
    f.codex.routes['turn/interrupt'] = () => interrupt.promise
    await f.adapter.dispatch({
      sessionId: 'session-1',
      fence: 7,
      clientMessageId: 'opening-send',
      body: USER_MESSAGE
    })
    const stopped = f.adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })
    expect(f.connection.calls.find((entry) => entry.method === 'turn/interrupt')?.params).toEqual({
      threadId: THREAD_ID,
      turnId: 'opening-turn'
    })
    f.notify('turn/started', 'opening-turn')
    expect((await f.reply(f.request({ turnId: 'opening-turn' }))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    interrupt.resolve({})
    await stopped
    await f.adapter.closeAll()
  })

  it('denies a late unnamed turn after Stop while turn/start has not answered', async () => {
    const f = await fixture()
    f.notify('turn/completed')
    const start = deferred<object>()
    f.codex.routes['turn/start'] = () => start.promise
    const dispatched = f.adapter.dispatch({
      sessionId: 'session-1',
      fence: 7,
      clientMessageId: 'unanswered-send',
      body: USER_MESSAGE
    })
    await vi.waitFor(() =>
      expect(f.connection.calls.some((entry) => entry.method === 'turn/start')).toBe(true)
    )
    expect(await f.adapter.cancelTurn({ sessionId: 'session-1', fence: 7 })).toMatchObject({
      cancelled: false
    })
    f.notify('turn/started', 'unknown-opening')
    expect((await f.reply(f.request({ turnId: 'unknown-opening' }))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    start.resolve({ turn: { id: 'unknown-opening' } })
    await dispatched
    await f.adapter.closeAll()
  })
  it('allows a first tool after 257 ordinary turns and still rejects completed turns and calls', async () => {
    const f = await fixture()
    f.notify('turn/completed')
    for (let index = 0; index < 257; index++) {
      f.notify('turn/started', `ordinary-${index}`)
      f.notify('turn/completed', `ordinary-${index}`)
    }
    f.notify('turn/started', 'new-turn')
    expect((await f.reply(f.request({ turnId: 'new-turn', callId: 'one' }))).success).toBe(true)
    expect((await f.reply(f.request({ turnId: 'new-turn', callId: 'one' }))).success).toBe(false)
    f.notify('turn/started', 'ordinary-0')
    expect((await f.reply(f.request({ turnId: 'ordinary-0' }))).success).toBe(false)
    f.notify('turn/started', 'ordinary-0')
    expect((await f.reply(f.request({ turnId: 'ordinary-0' }))).success).toBe(false)
    expect(f.tools.call).toHaveBeenCalledTimes(1)
    await f.adapter.closeAll()
  })

  it('keeps pending terminal writes revoked and retires them after the canonical row lands', async () => {
    const f = await fixture()
    const original = vi.mocked(f.sink.tryAppendItem!).getMockImplementation()!
    const pending: (() => void)[] = []
    vi.mocked(f.sink.tryAppendItem!).mockImplementation((...args) => {
      pending.push(() => {
        original(...args)
      })
      return { accepted: true }
    })
    f.notify('turn/completed')
    f.notify('turn/started')
    expect((await f.reply(f.request())).success).toBe(false)
    pending.splice(0).forEach((write) => write())
    vi.mocked(f.sink.tryAppendItem!).mockImplementation(original)
    f.notify('turn/started')
    expect((await f.reply(f.request())).success).toBe(false)
    f.notify('turn/started', 'subsequent')
    expect((await f.reply(f.request({ turnId: 'subsequent' }))).success).toBe(true)
    expect(f.tools.call).toHaveBeenCalledTimes(1)
    await f.adapter.closeAll()
  })

  it('passes exact unsaved replacement proof into the real persistent tool factory', async () => {
    const native = await fixture()
    const business = await teamToolFixture()
    const replacement = randomUUID()
    const codex = fakeCodex({
      'thread/resume': () => {
        throw new CodexAppServerRequestError(
          'thread/resume',
          -32600,
          `no rollout found for thread id ${business.threadId}`
        )
      },
      'thread/start': () => ({ thread: { id: replacement } })
    })
    const session = business.factory(business.sessionInput)
    const adapter = adapterFor(
      codex,
      { resumeThreadId: business.threadId, supersedeIfUnsaved: true },
      [],
      {
        prepareTeamTaskTools: async () => session
      }
    )
    await adapter.acquire({
      identity: identityFor(business.sessionInput.sessionId),
      fence: 7,
      spawnToken: 'spawn-9',
      events: native.sink
    })
    expect(await business.factory(business.sessionInput).bindThread(replacement, true)).toBe(true)
    expect(await business.factory(business.sessionInput).bindThread(business.threadId, true)).toBe(
      false
    )
    const connection = codex.connections[0]
    connection.handlers.onNotification?.('turn/started', {
      threadId: replacement,
      turn: { id: 'turn-real-factory' }
    })
    connection.handlers.onServerRequest?.({
      id: 999,
      method: 'item/tool/call',
      params: {
        threadId: replacement,
        turnId: 'turn-real-factory',
        callId: 'real-call',
        tool: 'hive_team_task_start',
        arguments: business.argumentsValue
      }
    })
    await vi.waitFor(() =>
      expect(connection.replies.find((reply) => reply.id === 999)?.result).toMatchObject({
        success: true
      })
    )
    expect(business.create).toHaveBeenCalledTimes(1)
    expect(business.start).toHaveBeenCalledTimes(1)
    await adapter.closeAll()
    await native.adapter.closeAll()
  })

  it.each(['prepare', 'catalog', 'bind'] as const)(
    'logs a sanitized %s failure while preserving chat',
    async (phase) => {
      const f = await fixture()
      const logger = { warn: vi.fn(), error: vi.fn() }
      const codex = fakeCodex()
      const tools = { ...f.tools }
      if (phase === 'bind') {
        tools.bindThread = async () => {
          throw new Error('secret-token')
        }
      }
      if (phase === 'catalog') {
        tools.definitions = []
      }
      const adapter = adapterFor(codex, {}, [], {
        logger,
        prepareTeamTaskTools: async () => {
          if (phase === 'prepare') {
            throw new Error('secret-token')
          }
          return tools
        }
      })
      await adapter.acquire({
        identity: identityFor('session-log'),
        fence: 7,
        spawnToken: 'spawn-9'
      })
      expect(logger.warn).toHaveBeenCalledWith(
        'Team task tools unavailable',
        expect.objectContaining({ scope: 'codex-team-task-tools', phase })
      )
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-token')
      await adapter.closeAll()
      await f.adapter.closeAll()
    }
  )

  it('never prepares tools for a task-origin managed session', async () => {
    const prepare = vi.fn()
    const tools = await prepareCodexTeamTaskTools(
      { resolveLaunch: vi.fn(), prepareTeamTaskTools: prepare },
      {
        identity: identityFor('session-1'),
        fence: 7,
        spawnToken: 'spawn-9',
        taskOrigin: {
          source: {
            kind: 'task_execution',
            runtimeRecordId: 'runtime-1',
            ownershipEpoch: 1,
            executionId: 'execution-1',
            executionEpoch: 1,
            commandFingerprint: 'a'.repeat(64)
          },
          operationCallerKey: 'caller',
          operationId: 'operation',
          launchFingerprint: 'b'.repeat(64),
          validate: vi.fn()
        }
      }
    )
    expect(tools).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
  })

  it('keeps chat acquisition usable when the tool catalog cannot be trusted', async () => {
    const codex = fakeCodex()
    const bindThread = vi.fn(async () => true)
    const adapter = adapterFor(codex, {}, [], {
      prepareTeamTaskTools: async () => ({
        definitions: [
          { name: 'unexpected', description: 'invalid', inputSchema: { type: 'object' } }
        ],
        bindThread,
        call: vi.fn()
      })
    })
    await adapter.acquire({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn-9' })
    expect(codex.connections[0].calls[0].params).not.toHaveProperty('dynamicTools')
    expect(bindThread).not.toHaveBeenCalled()
    await adapter.closeAll()
  })

  it('waits for the actual write barrier and accepts the worst escaped 8192-character requirement', async () => {
    const f = await fixture()
    const write = deferred<{ ok: true }>()
    vi.mocked(f.sink.written!).mockReturnValue(write.promise)
    const id = f.request({
      namespace: null,
      arguments: { requirement: '\u0001'.repeat(8192), title: '\u0001'.repeat(240) }
    })
    expect(f.tools.call).not.toHaveBeenCalled()
    write.resolve({ ok: true })
    expect((await f.reply(id)).success).toBe(true)
    await f.adapter.closeAll()
  })

  it('does not forward late success even when the facade did not check its callback', async () => {
    const f = await fixture()
    const result = deferred<{ success: boolean; value: Record<string, unknown> }>()
    vi.mocked(f.tools.call).mockReturnValue(result.promise)
    const id = f.request()
    await vi.waitFor(() => expect(f.tools.call).toHaveBeenCalledOnce())
    f.notify('turn/completed')
    result.resolve({ success: true, value: { caseId: 'case-1' } })
    expect((await f.reply(id)).success).toBe(false)
    await f.adapter.closeAll()
  })

  it('registers flat fresh definitions and returns exact request ids for both tools after durable writes', async () => {
    const f = await fixture()
    expect(f.connection.calls[0]).toMatchObject({
      method: 'thread/start',
      params: {
        dynamicTools: f.tools.definitions.map((tool) => ({
          ...tool,
          type: 'function',
          deferLoading: false
        }))
      }
    })
    expect(f.tools.bindThread).toHaveBeenCalledWith(THREAD_ID, false, undefined)
    for (const tool of f.tools.definitions) {
      const id = f.request({ tool: tool.name, callId: tool.name }, `request-${tool.name}`)
      expect(await f.reply(id)).toEqual({
        success: true,
        contentItems: [{ type: 'inputText', text: '{"caseId":"case-1"}' }]
      })
    }
    expect(f.sink.written).toHaveBeenCalledTimes(2)
    expect(f.tools.call).toHaveBeenCalledTimes(2)
    await f.adapter.closeAll()
  })

  it.each([true, false])(
    'does not inject on resume and respects catalog binding %s',
    async (bound) => {
      const f = await fixture({ resume: true, bound })
      expect(f.connection.calls[0]).toMatchObject({ method: 'thread/resume' })
      expect(f.connection.calls[0].params).not.toHaveProperty('dynamicTools')
      expect(f.tools.bindThread).toHaveBeenCalledWith(THREAD_ID, true, undefined)
      expect((await f.reply(f.request())).success).toBe(bound)
      expect(f.tools.call).toHaveBeenCalledTimes(bound ? 1 : 0)
      await f.adapter.closeAll()
    }
  )

  it.each([
    { threadId: 'foreign-thread' },
    { turnId: 'foreign-turn' },
    { namespace: 'foreign' },
    { callId: '' },
    { extra: true },
    { arguments: 'x'.repeat(65_537) },
    { arguments: JSON.parse(`${'{"x":'.repeat(14)}0${'}'.repeat(14)}`) },
    { tool: 'unregistered' }
  ])('refuses malformed or unowned requests %j', async (patch) => {
    const f = await fixture()
    f.notify('turn/started', 'foreign-turn', 'foreign-thread')
    expect((await f.reply(f.request(patch))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    await f.adapter.closeAll()
  })

  it('does not run without a durable sink', async () => {
    const f = await fixture({ sink: false })
    expect((await f.reply(f.request())).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    await f.adapter.closeAll()
  })

  it('does not execute oversized server request identities', async () => {
    const f = await fixture()
    expect((await f.reply(f.request({}, 'x'.repeat(257)))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    await f.adapter.closeAll()
  })

  it.each(['append', 'publish', 'write'] as const)(
    'refuses %s journal failure before side effects',
    async (phase) => {
      const f = await fixture()
      if (phase === 'append') {
        vi.mocked(f.sink.tryAppendItem!).mockReturnValue({
          accepted: false,
          reason: 'backpressure'
        })
      }
      if (phase === 'publish') {
        vi.mocked(f.sink.tryPublish!).mockReturnValue({ accepted: false, reason: 'failed' })
      }
      if (phase === 'write') {
        vi.mocked(f.sink.written!).mockResolvedValue({ ok: false, error: new Error('secret') })
      }
      const result = await f.reply(f.request())
      expect(result.success).toBe(false)
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(f.tools.call).not.toHaveBeenCalled()
      await f.adapter.closeAll()
    }
  )

  it('revokes immediately on cancel before interrupt ACK and before an awaited journal write', async () => {
    const f = await fixture()
    const write = deferred<{ ok: true }>()
    const interrupt = deferred<object>()
    vi.mocked(f.sink.written!).mockReturnValue(write.promise)
    f.codex.routes['turn/interrupt'] = () => interrupt.promise
    const id = f.request()
    const cancelled = f.adapter.cancelTurn({ sessionId: 'session-1', turnId: 'turn-1', fence: 7 })
    write.resolve({ ok: true })
    expect((await f.reply(id)).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    f.notify('turn/started')
    expect((await f.reply(f.request())).success).toBe(false)
    interrupt.resolve({})
    await cancelled
    await f.adapter.closeAll()
  })

  it.each(['completed', 'closed', 'superseded'] as const)(
    'blocks late effects and success after %s',
    async (ending) => {
      const f = await fixture()
      const wait = deferred<void>()
      const effects = vi.fn()
      vi.mocked(f.tools.call).mockImplementation(async (_input, guard) => {
        await wait.promise
        guard()
        effects()
        return { success: true, value: {} }
      })
      const id = f.request()
      await vi.waitFor(() => expect(f.tools.call).toHaveBeenCalledTimes(1))
      if (ending === 'completed') {
        f.notify('turn/completed')
      }
      if (ending === 'closed') {
        await f.adapter.closeSession('session-1')
      }
      if (ending === 'superseded') {
        await f.acquire()
      }
      wait.resolve()
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(effects).not.toHaveBeenCalled()
      expect(f.connection.replies.find((entry) => entry.id === id)?.result).not.toMatchObject({
        success: true
      })
      await f.adapter.closeAll()
    }
  )

  it('bounds concurrency, replay and output and sanitizes facade exceptions', async () => {
    const f = await fixture()
    const wait = deferred<{ success: boolean; value: Record<string, unknown> }>()
    vi.mocked(f.tools.call).mockReturnValue(wait.promise)
    const first = f.request({ callId: 'one' })
    const second = f.request({ callId: 'two' })
    expect((await f.reply(f.request({ callId: 'three' }))).success).toBe(false)
    expect((await f.reply(f.request({ callId: 'one' }))).success).toBe(false)
    wait.resolve({ success: true, value: { text: 'x'.repeat(70_000) } })
    expect((await f.reply(first)).success).toBe(false)
    expect((await f.reply(second)).success).toBe(false)
    vi.mocked(f.tools.call).mockRejectedValue(new Error('credential-secret'))
    expect(JSON.stringify(await f.reply(f.request({ callId: 'four' })))).not.toContain(
      'credential-secret'
    )
    await f.adapter.closeAll()
  })

  it('does not authorize a turn whose start journal admission failed', async () => {
    const f = await fixture()
    vi.mocked(f.sink.tryAppendItem!).mockReturnValue({ accepted: false, reason: 'backpressure' })
    f.notify('turn/started', 'not-admitted')
    expect((await f.reply(f.request({ turnId: 'not-admitted' }))).success).toBe(false)
    expect(f.tools.call).not.toHaveBeenCalled()
    await f.adapter.closeAll()
  })

  it('starts a new catalog when the original fresh thread is proven unsaved', async () => {
    const codex = fakeCodex({
      'thread/start': () => ({ thread: { id: 'replacement-thread' } }),
      'thread/resume': () => {
        throw new CodexAppServerRequestError(
          'thread/resume',
          -32600,
          `no rollout found for thread id ${THREAD_ID}`
        )
      }
    })
    const tools: NativeTeamTaskToolSession = {
      definitions: ['hive_team_task_start', 'hive_team_task_status'].map((name) => ({
        name,
        description: name,
        inputSchema: { type: 'object' }
      })),
      bindThread: vi.fn(async () => true),
      call: vi.fn()
    }
    const adapter = adapterFor(codex, { resumeThreadId: THREAD_ID, supersedeIfUnsaved: true }, [], {
      prepareTeamTaskTools: async () => tools
    })
    await adapter.acquire({ identity: identityFor('session-1'), fence: 7, spawnToken: 'spawn-9' })
    expect(tools.bindThread).toHaveBeenCalledWith('replacement-thread', false, THREAD_ID)
    expect(
      codex.connections[0].calls.find((call) => call.method === 'thread/start')?.params
    ).toHaveProperty('dynamicTools')
    await adapter.closeAll()
  })
})
