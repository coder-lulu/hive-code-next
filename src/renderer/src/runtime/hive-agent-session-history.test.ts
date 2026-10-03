import { describe, expect, it, vi } from 'vitest'
import type { RuntimeApi } from '../../../preload/api/runtime-api'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { createHiveAgentSessionClient } from './hive-agent-session-client'
import { subscribeHiveAgentSession } from './hive-agent-session-subscription'

const sessionId = 'ha-session:12345678-1234-4234-8234-123456789abc'
const otherSession = 'ha-session:12345678-1234-4234-8234-123456789abd'
const cursor = { epoch: 'epoch', sequence: 1 }
const item = {
  itemId: 'message',
  revision: 1,
  sequence: 1,
  observedAt: 1,
  body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'New API reply' }] }
}
const page = {
  sessionId,
  epoch: cursor.epoch,
  direction: 'tail',
  items: [item],
  submissions: [],
  removedItemIds: [],
  window: { oldest: null, newest: null, nextCursor: cursor },
  hasOlder: false,
  hasNewer: false
}
const snapshot = { type: 'snapshot', sessionId, page, fence: 1 }
const response = (result: unknown): RuntimeRpcResponse<unknown> => ({
  id: 'request',
  ok: true,
  result,
  _meta: { runtimeId: 'local' }
})

function setup() {
  const controller = new AbortController()
  let emit!: (value: RuntimeRpcResponse<unknown>) => void
  let resolve!: (value: Awaited<ReturnType<RuntimeApi['runtime']['subscribe']>>) => void
  let reject!: (error: Error) => void
  const handle = { unsubscribe: vi.fn(), sendBinary: vi.fn() }
  const subscribe = vi.fn<RuntimeApi['runtime']['subscribe']>((_args, callback) => {
    emit = callback
    return new Promise((yes, no) => {
      resolve = yes
      reject = no
    })
  })
  const onEvent = vi.fn()
  const onClose = vi.fn()
  const options = {
    projectSelector: 'id:project',
    params: { sessionId },
    signal: controller.signal,
    subscribe,
    onEvent,
    onClose
  }
  return {
    controller,
    handle,
    subscribe,
    onEvent,
    onClose,
    options,
    emit: (value: unknown) => emit(response(value)),
    opened: async () => {
      resolve(handle)
      await Promise.resolve()
    },
    failed: async () => {
      reject(new Error('private-canary'))
      await Promise.resolve()
    }
  }
}

describe('HiveAgent history and export', () => {
  it.each(['history', 'exportPage'] as const)(
    'reads %s and preserves reset results',
    async (method) => {
      const call = vi.fn(async () =>
        response({ ok: true, value: { ok: false, reset: 'epoch_changed', page } })
      )
      const client = createHiveAgentSessionClient({
        projectSelector: 'id:project',
        signal: new AbortController().signal,
        call
      })
      expect(await client[method]({ sessionId })).toEqual({
        ok: false,
        reset: 'epoch_changed',
        page
      })
      expect(call.mock.calls).toHaveLength(1)
    }
  )
  it.each([
    { ...page, sessionId: otherSession },
    { ...page, items: [{ itemId: 'bad', body: { kind: 'message', blocks: null } }] },
    { ...page, liveCursor: { ...cursor, epoch: 'other' } }
  ])('rejects invalid or crossed history %#', async (invalid) => {
    const client = createHiveAgentSessionClient({
      projectSelector: 'id:project',
      signal: new AbortController().signal,
      call: async () => response({ ok: true, value: { ok: true, page: invalid } })
    })
    await expect(client.history({ sessionId })).rejects.toThrow('hive_agent_outcome_unknown')
  })
})

describe('HiveAgent subscription lifetime', () => {
  it('accepts snapshot, batch and reset while opening; end only disconnects', async () => {
    const s = setup()
    const dispose = subscribeHiveAgentSession(s.options)
    s.emit(snapshot)
    s.emit({
      type: 'batch',
      sessionId,
      batch: { cursor, items: [], submissions: [], removedItemIds: ['old'] }
    })
    s.emit({ ...snapshot, type: 'reset', reset: 'epoch_changed' })
    expect(s.onEvent).toHaveBeenCalledTimes(3)
    s.emit({ type: 'end' })
    expect(s.onClose).toHaveBeenCalledExactlyOnceWith('disconnected')
    await s.opened()
    dispose()
    expect(s.handle.unsubscribe).toHaveBeenCalledOnce()
    expect(s.subscribe).toHaveBeenCalledExactlyOnceWith(
      {
        method: 'hiveAgent.subscribe',
        params: { projectSelector: 'id:project', params: { sessionId } }
      },
      expect.any(Function)
    )
  })
  it.each(['abort', 'dispose'] as const)(
    'releases a late handle after %s and drops stale events',
    async (action) => {
      const s = setup()
      const dispose = subscribeHiveAgentSession(s.options)
      if (action === 'abort') {
        s.controller.abort()
      } else {
        dispose()
      }
      s.emit(snapshot)
      await s.opened()
      expect(s.handle.unsubscribe).toHaveBeenCalledOnce()
      expect(s.onEvent).not.toHaveBeenCalled()
      expect(s.onClose).not.toHaveBeenCalled()
    }
  )
  it('releases an open handle once on identity invalidation', async () => {
    const s = setup()
    const dispose = subscribeHiveAgentSession(s.options)
    await s.opened()
    s.controller.abort()
    dispose()
    s.emit(snapshot)
    expect(s.handle.unsubscribe).toHaveBeenCalledOnce()
    expect(s.onEvent).not.toHaveBeenCalled()
  })
  it('closes and releases when the consumer rejects a frame', async () => {
    const s = setup()
    s.onEvent.mockImplementation(() => {
      throw new Error('private-canary')
    })
    subscribeHiveAgentSession(s.options)
    await s.opened()
    s.emit(snapshot)
    s.emit(snapshot)
    expect(s.onEvent).toHaveBeenCalledOnce()
    expect(s.onClose).toHaveBeenCalledExactlyOnceWith('hive_agent_outcome_unknown')
    expect(s.handle.unsubscribe).toHaveBeenCalledOnce()
  })
  it.each([
    { ...snapshot, sessionId: otherSession },
    { ...snapshot, page: { ...page, sessionId: otherSession } },
    { ...snapshot, page: { ...page, submissions: [null] } },
    { type: 'unknown', private: 'private-canary' }
  ])('closes on invalid or crossed frame %# without retry', async (invalid) => {
    const s = setup()
    subscribeHiveAgentSession(s.options)
    s.emit(invalid)
    s.emit(snapshot)
    await s.opened()
    expect(s.onClose).toHaveBeenCalledExactlyOnceWith('hive_agent_outcome_unknown')
    expect(s.onEvent).not.toHaveBeenCalled()
    expect(s.subscribe).toHaveBeenCalledOnce()
    expect(s.handle.unsubscribe).toHaveBeenCalledOnce()
  })
  it('reports known host failures and sanitizes transport rejection', async () => {
    const s = setup()
    subscribeHiveAgentSession(s.options)
    s.emit({ ok: false, error: { code: 'hive_agent_forbidden' } })
    await s.failed()
    expect(s.onClose).toHaveBeenCalledExactlyOnceWith('hive_agent_forbidden')
    const other = setup()
    subscribeHiveAgentSession(other.options)
    await other.failed()
    expect(other.onClose).toHaveBeenCalledExactlyOnceWith('hive_agent_outcome_unknown')
  })
  it('does not open invalid or already aborted subscriptions', () => {
    const s = setup()
    subscribeHiveAgentSession({ ...s.options, params: { sessionId: 'invalid' } })
    expect(s.onClose).toHaveBeenCalledExactlyOnceWith('hive_agent_invalid_request')
    s.controller.abort()
    subscribeHiveAgentSession(s.options)
    expect(s.subscribe).not.toHaveBeenCalled()
    expect(s.onClose).toHaveBeenCalledOnce()
  })
})
