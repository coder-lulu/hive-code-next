// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { RuntimeApi } from '../../../../preload/api/runtime-api'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import type { HiveAccountState } from '../../../../shared/hive-account'
import { useHiveAgentConversation } from './use-hive-agent-conversation'

const sessionId = 'ha-session:12345678-1234-4234-8234-123456789abc'
const selection = {
  modelId: 'model-a',
  protocol: 'RESPONSES' as const,
  snapshotRevision: 'a'.repeat(64)
}
const session = {
  schemaVersion: 1,
  sessionId,
  profileId: 'personal',
  createdAt: 1,
  updatedAt: 1,
  visibility: 'private',
  retention: 'until-deleted',
  stateRevision: 0
}
const response = (result: unknown): RuntimeRpcResponse<unknown> => ({
  id: 'request',
  ok: true,
  result,
  _meta: { runtimeId: 'local' }
})
const value = (result: unknown) => response({ ok: true, value: result })
const snapshot = {
  type: 'snapshot',
  sessionId,
  fence: 1,
  page: {
    sessionId,
    epoch: 'epoch',
    direction: 'tail',
    items: [],
    submissions: [],
    removedItemIds: [],
    window: { oldest: null, newest: null, nextCursor: { epoch: 'epoch', sequence: 0 } },
    hasOlder: false,
    hasNewer: false
  }
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function fixture() {
  const callbacks: ((response: RuntimeRpcResponse<unknown>) => void)[] = []
  const unsubscribe = vi.fn()
  const onChange = new Set<(state: HiveAccountState) => void>()
  const call = vi.fn<RuntimeApi['runtime']['call']>(async () => value({ session }))
  const subscribe = vi.fn<RuntimeApi['runtime']['subscribe']>(async (_args, callback) => {
    callbacks.push(callback)
    callback(response(snapshot))
    return { unsubscribe, sendBinary: vi.fn() }
  })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      runtime: { call, subscribe },
      hiveAccount: {
        onStateChanged: (callback: (state: HiveAccountState) => void) => {
          onChange.add(callback)
          return () => onChange.delete(callback)
        }
      }
    }
  })
  const hook = renderHook(() => useHiveAgentConversation('owner', 'workspace', sessionId))
  return { ...hook, call, subscribe, unsubscribe, callbacks, onChange }
}
it('reads the aggregate and reuses the existing timeline reducer', async () => {
  const f = fixture()
  await waitFor(() => expect(f.result.current.aggregate?.session.sessionId).toBe(sessionId))
  expect(f.result.current.connected).toBe(true)
  expect(f.result.current.timeline.epoch).toBe('epoch')
  act(() => f.callbacks[0](response({ type: 'end' })))
  expect(f.result.current.connected).toBe(false)
  expect(f.result.current.error).toBe('disconnected')
})
it('reports older history progress to the read-only transcript list', async () => {
  const f = fixture()
  const item = (sequence: number) => ({
    itemId: `item-${sequence}`,
    revision: 1,
    sequence,
    observedAt: sequence,
    body: { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'History' }] }
  })
  await waitFor(() => expect(f.result.current.aggregate).not.toBeNull())
  act(() =>
    f.callbacks[0](
      response({
        ...snapshot,
        page: { ...snapshot.page, items: [item(2)], hasOlder: true }
      })
    )
  )
  f.call.mockImplementation(async (args) =>
    args.method === 'hiveAgent.history'
      ? value({
          ok: true,
          page: {
            ...snapshot.page,
            direction: 'before',
            items: [item(1)],
            hasOlder: false
          }
        })
      : value({ session })
  )

  let outcome = ''
  await act(async () => {
    outcome = await f.result.current.loadEarlier()
  })
  expect(outcome).toBe('applied')
  expect(f.result.current.timeline.items.map((entry) => entry.sequence)).toEqual([1, 2])
  expect(await f.result.current.loadEarlier()).toBe('exhausted')
})
it('locks double submits before rendering and never resends a lost response', async () => {
  const f = fixture()
  await waitFor(() => expect(f.result.current.aggregate).not.toBeNull())
  let reject!: (error: Error) => void
  f.call.mockImplementation(async (args) =>
    args.method === 'hiveAgent.submit'
      ? new Promise((_resolve, fail) => {
          reject = fail
        })
      : value({ session })
  )
  let sent!: Promise<boolean>
  await act(async () => {
    sent = f.result.current.submit('hello', selection)
    expect(await f.result.current.submit('hello', selection)).toBe(false)
  })
  await act(async () => {
    reject(new Error('private-canary'))
    await sent
  })
  expect(f.result.current.uncertain).toBe(true)
  await act(async () => {
    f.result.current.refresh()
    await f.result.current.submit('hello', selection)
  })
  expect(f.call.mock.calls.filter(([args]) => args.method === 'hiveAgent.submit')).toHaveLength(1)
  expect(f.result.current.error ?? '').not.toContain('private-canary')
  expect(f.result.current.uncertain).toBe(true)
  expect(f.subscribe).toHaveBeenCalledTimes(2)
})
it('clears private history on sign-out and rejects late events', async () => {
  const f = fixture()
  await waitFor(() => expect(f.result.current.aggregate).not.toBeNull())
  act(() => {
    f.onChange.forEach((notify) =>
      notify({ configured: true, status: 'signed-out', persistence: 'none' })
    )
    f.callbacks[0](response(snapshot))
  })
  expect(f.result.current.aggregate).toBeNull()
  expect(f.result.current.timeline.epoch).toBeNull()
  expect(f.result.current.connected).toBe(false)
  expect(f.unsubscribe).toHaveBeenCalledOnce()
})
it('renews only read subscriptions and releases both handles on unmount', async () => {
  const f = fixture()
  await waitFor(() => expect(f.result.current.aggregate).not.toBeNull())
  vi.useFakeTimers()
  // Timers belong to the effect; remount under the fake clock.
  f.unmount()
  const next = fixture()
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000)
  })
  expect(next.subscribe).toHaveBeenCalledTimes(2)
  expect(next.subscribe.mock.calls[1][0].params).toEqual({
    projectSelector: 'workspace',
    params: { sessionId, cursor: { epoch: 'epoch', sequence: 0 } }
  })
  expect(next.call.mock.calls.every(([args]) => args.method === 'hiveAgent.read')).toBe(true)
  next.unmount()
  expect(next.unsubscribe).toHaveBeenCalledTimes(2)
})
it('refuses unreadable journal reset instead of enabling send', async () => {
  const f = fixture()
  await waitFor(() => expect(f.result.current.aggregate).not.toBeNull())
  act(() => f.callbacks[0](response({ ...snapshot, type: 'reset', reset: 'schema_unreadable' })))
  expect(f.result.current.connected).toBe(false)
  expect(await f.result.current.submit('hello', selection)).toBe(false)
  expect(f.call.mock.calls.every(([args]) => args.method === 'hiveAgent.read')).toBe(true)
})
