import { expect, it, vi } from 'vitest'
import { hiveAgentDesktopMethods } from './hive-agent-desktop-methods'
import { isStreamingMethod, type RpcContext } from '../runtime/rpc/core'
import type { HiveAgentLocalRuntime } from '../native-chat/hive-agent-local-runtime'
const sessionId = 'ha-session:11111111-1111-4111-8111-111111111111'
const input = { projectSelector: 'id:folder', params: { sessionId } }
function setup() {
  let trusted = true
  const close = vi.fn(),
    call = vi.fn(async () => ({ ok: true, value: { sessionId } })),
    subscribe = vi.fn(async () => close)
  const runtime = { openProject: vi.fn(async () => ({ call, subscribe })) }
  const methods = hiveAgentDesktopMethods({
    getRuntime: () => runtime as unknown as HiveAgentLocalRuntime,
    assertSender: () => {
      if (!trusted) {
        throw new Error('private-canary')
      }
    }
  })
  const method = methods.find((item) => item.name === 'hiveAgent.read')!
  if (isStreamingMethod(method)) {
    throw new Error('unexpected stream')
  }
  const stream = methods.find((item) => item.name === 'hiveAgent.subscribe')!
  if (!isStreamingMethod(stream)) {
    throw new Error('missing stream')
  }
  const controller = new AbortController()
  const context = { runtime: {}, signal: controller.signal } as RpcContext
  return {
    methods,
    runtime,
    call,
    subscribe,
    close,
    controller,
    context,
    invoke: (raw: unknown) => method.handler(raw, context),
    stream,
    revoke: () => {
      trusted = false
    }
  }
}
it('forwards only the parsed command to a project bound by the main process', async () => {
  const test = setup()
  expect(await test.invoke(input)).toEqual({ ok: true, value: { sessionId } })
  expect(test.runtime.openProject).toHaveBeenCalledExactlyOnceWith('id:folder')
  expect(test.call).toHaveBeenCalledExactlyOnceWith('hiveAgent.read', { sessionId })
})
it.each([
  null,
  { ...input, owner: 'injected' },
  { ...input, params: { sessionId, token: 'private' } },
  { ...input, projectSelector: '' }
])('rejects invalid envelope %# before opening a project', async (raw) => {
  const test = setup()
  expect(await test.invoke(raw)).toMatchObject({ ok: false })
  expect(test.runtime.openProject).not.toHaveBeenCalled()
})
it('rejects an untrusted sender before identity lookup', async () => {
  const test = setup()
  test.revoke()
  expect(await test.invoke(input)).toEqual({ ok: false, error: { code: 'hive_agent_forbidden' } })
  expect(test.runtime.openProject).not.toHaveBeenCalled()
})
it('rechecks the sender after asynchronous project authorization', async () => {
  const test = setup()
  test.runtime.openProject.mockImplementation(async () => {
    test.revoke()
    return { call: test.call, subscribe: test.subscribe }
  })
  expect(await test.invoke(input)).toMatchObject({ ok: false })
  expect(test.call).not.toHaveBeenCalled()
})
it('discards a late response after the sender changes', async () => {
  const test = setup()
  test.call.mockImplementation(async () => {
    test.revoke()
    return { ok: true, value: { sessionId } }
  })
  expect(await test.invoke(input)).toMatchObject({ ok: false })
})
it('closes a subscription on the existing transport cancellation signal', async () => {
  const test = setup()
  const emit = vi.fn()
  const running = test.stream.handler(input, test.context, emit)
  await vi.waitFor(() => expect(test.subscribe).toHaveBeenCalledOnce())
  test.controller.abort()
  await running
  expect(test.close).toHaveBeenCalledOnce()
})
it('does not create subscriptions for an already closed transport', async () => {
  const test = setup()
  test.controller.abort()
  await test.stream.handler(input, test.context, vi.fn())
  expect(test.runtime.openProject).not.toHaveBeenCalled()
})
