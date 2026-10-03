import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeRpcAccountConnection } from './runtime-rpc-account-dispatch'
type DispatchOptions = {
  authorizeRequest: (method: string) => boolean
  sendBinary: (bytes: Uint8Array) => boolean
  registerBinaryStreamHandler: (id: string, handler: unknown) => void
  registerBinaryMessageHandler: (handler: unknown) => void
}

const mock = vi.hoisted(() => ({
  dispatch: vi.fn<
    (request: unknown, reply: (value: string) => void, options: DispatchOptions) => Promise<void>
  >(async () => {}),
  binary: vi.fn(),
  deleteConnection: vi.fn(),
  cleanup: vi.fn(),
  cancel: vi.fn(),
  abort: vi.fn(),
  dispose: vi.fn(),
  registerStream: vi.fn(),
  registerMessage: vi.fn(),
  release: vi.fn()
}))
vi.mock('./runtime-rpc-cloud-dispatch', () => ({
  LOCAL_ONLY_RPC_METHODS: new Set(['cloudRuntime.claim']),
  RuntimeRpcCloudDispatch: class {
    dispatcher = { dispatchStreaming: mock.dispatch }
    binaryMessageRouter = { dispatch: mock.binary, deleteConnection: mock.deleteConnection }
    runtime = {
      cleanupSubscriptionsForConnection: mock.cleanup,
      cancelMobileDictationForConnection: mock.cancel
    }
    abortWebSocketDispatches = mock.abort
    registerBinaryStreamHandler = mock.registerStream
    registerBinaryMessageHandler = mock.registerMessage
    releaseLongPoll = mock.release
    admitLongPoll() {
      return null
    }
    registerWebSocketDispatchAbort() {
      return { signal: new AbortController().signal, dispose: mock.dispose }
    }
    buildError(id: string, code: string, error: string) {
      return { id, code, error }
    }
  }
}))
import { RuntimeRpcAccountDispatch } from './runtime-rpc-account-dispatch'

beforeEach(() => {
  vi.clearAllMocks()
  mock.dispatch.mockImplementation(async () => {})
})
function fixture(runtimeSessionId = 'runtime-session-1') {
  let text!: (
    raw: string,
    reply: (value: string) => void,
    binary: (bytes: Uint8Array) => boolean
  ) => void
  let binary!: (bytes: Uint8Array) => void
  let valid = true
  const revalidate = vi.fn(() => valid)
  const ws = {}
  const connection = {
    ws,
    connectionId: 'account-connection-1',
    runtimeSessionId,
    operationCallerKey: `account-runtime:${'a'.repeat(64)}`,
    revalidate,
    channel: {
      onMessage: (handler: typeof text) => {
        text = handler
      },
      onBinaryMessage: (handler: typeof binary) => {
        binary = handler
      },
      clientCapabilities: []
    }
  }
  const detach = new RuntimeRpcAccountDispatch(
    {} as ConstructorParameters<typeof RuntimeRpcAccountDispatch>[0]
  ).attachAccountRuntimeConnection(connection as unknown as RuntimeRpcAccountConnection)
  const reply = vi.fn()
  const sendBinary = vi.fn(() => true)
  return {
    detach,
    ws,
    reply,
    sendBinary,
    revalidate,
    invalidate: () => {
      valid = false
    },
    text: (request: Record<string, unknown>) => text(JSON.stringify(request), reply, sendBinary),
    binary: (bytes: Uint8Array) => binary(bytes)
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

it('binds only terminal ownership fields to the authenticated physical session', async () => {
  const f = fixture()
  for (const method of [
    'terminal.subscribe',
    'terminal.send',
    'terminal.updateViewport',
    'terminal.setDisplayMode',
    'terminal.unsubscribe'
  ]) {
    const params = {
      terminal: 'terminal-1',
      client: { id: 'another-session', type: 'mobile' },
      extra: 7
    }
    f.text({ id: method, method, params })
    expect(mock.dispatch).toHaveBeenLastCalledWith(
      {
        id: method,
        method,
        params: { ...params, client: { ...params.client, id: 'account-runtime:runtime-session-1' } }
      },
      expect.any(Function),
      expect.objectContaining({ clientId: 'account-runtime:runtime-session-1' })
    )
  }
  f.text({
    id: 'resize',
    method: 'terminal.resizeForClient',
    params: { clientId: 'forged', mode: 'restore' }
  })
  expect(mock.dispatch.mock.lastCall?.[0]).toMatchObject({
    params: { clientId: 'account-runtime:runtime-session-1', mode: 'restore' }
  })
  const other = fixture('runtime-session-2')
  other.text({
    id: 'other',
    method: 'terminal.send',
    params: { client: { id: 'another-session', type: 'mobile' }, text: 'hello' }
  })
  expect(mock.dispatch.mock.lastCall?.[0]).toMatchObject({
    params: { client: { id: 'account-runtime:runtime-session-2', type: 'mobile' } }
  })
  const untouched = { id: 'read', method: 'runtime.read', params: { client: { id: 'original' } } }
  f.text(untouched)
  expect(mock.dispatch.mock.lastCall?.[0]).toEqual(untouched)
  await tick()
  f.detach()
  other.detach()
})

it('does not repair malformed terminal identity or dispatch a revoked session', async () => {
  const f = fixture()
  for (const client of [null, [], { id: '' }, { id: 42 }]) {
    f.text({ id: 'invalid', method: 'terminal.subscribe', params: { client } })
  }
  f.text({ id: 'invalid-resize', method: 'terminal.resizeForClient', params: { clientId: null } })
  expect(mock.dispatch).not.toHaveBeenCalled()
  expect(f.reply).toHaveBeenCalledTimes(5)
  expect(f.reply.mock.calls.every(([raw]) => JSON.parse(raw).code === 'invalid_argument')).toBe(
    true
  )
  f.invalidate()
  f.text({
    id: 'revoked',
    method: 'terminal.send',
    params: { client: { id: 'valid', type: 'mobile' } }
  })
  expect(mock.dispatch).not.toHaveBeenCalled()
  expect(f.reply).toHaveBeenCalledTimes(5)
  await tick()
  f.detach()
})

it('rewrites only the exact supplied terminal unsubscribe client suffix', async () => {
  const f = fixture()
  for (const [subscriptionId, expected] of [
    ['terminal:handle:account-client:abc', 'terminal:handle:account-runtime:runtime-session-1'],
    ['terminal:handle:another-client', 'terminal:handle:another-client'],
    ['bare-handle', 'bare-handle']
  ]) {
    f.text({
      id: 'unsubscribe',
      method: 'terminal.unsubscribe',
      params: { subscriptionId, client: { id: 'account-client:abc' } }
    })
    expect(mock.dispatch.mock.lastCall?.[0]).toMatchObject({
      params: { subscriptionId: expected, client: { id: 'account-runtime:runtime-session-1' } }
    })
  }
  await tick()
  f.detach()
})

it('revalidates text, binary and delayed output and detaches using only its connection ownership', async () => {
  const f = fixture()
  let output!: (value: string) => void
  let options!: {
    sendBinary: (bytes: Uint8Array) => boolean
    registerBinaryStreamHandler: (id: string, handler: unknown) => void
    registerBinaryMessageHandler: (handler: unknown) => void
  }
  mock.dispatch.mockImplementation(async (...args) => {
    output = args[1]
    options = args[2]
  })
  f.text({ id: 'one', method: 'runtime.read' })
  f.binary(new Uint8Array([1]))
  expect(mock.dispatch).toHaveBeenCalledOnce()
  expect(mock.binary).toHaveBeenCalledWith('account-connection-1', new Uint8Array([1]))
  const stream = vi.fn()
  options.registerBinaryStreamHandler('stream-1', stream)
  expect(mock.registerStream).toHaveBeenCalledWith('account-connection-1', 'stream-1', stream)
  f.invalidate()
  output('secret-output')
  expect(options.sendBinary(new Uint8Array([2]))).toBe(false)
  f.binary(new Uint8Array([3]))
  f.text({ id: 'two', method: 'runtime.read' })
  expect(f.reply).not.toHaveBeenCalled()
  expect(f.sendBinary).not.toHaveBeenCalled()
  expect(mock.binary).toHaveBeenCalledOnce()
  expect(mock.dispatch).toHaveBeenCalledOnce()
  f.detach()
  f.detach()
  options.registerBinaryStreamHandler('late-stream', stream)
  options.registerBinaryMessageHandler(stream)
  expect(mock.registerStream).toHaveBeenCalledOnce()
  expect(mock.registerMessage).not.toHaveBeenCalled()
  expect(mock.abort).toHaveBeenCalledExactlyOnceWith(f.ws)
  expect(mock.cleanup).toHaveBeenCalledExactlyOnceWith('account-connection-1')
  expect(mock.cancel).toHaveBeenCalledExactlyOnceWith('account-connection-1')
  expect(mock.deleteConnection).toHaveBeenCalledExactlyOnceWith('account-connection-1')
  await tick()
})

it('bounds pending RPC to 128 and releases capacity after completion', async () => {
  const f = fixture()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  mock.dispatch.mockImplementation(() => pending)
  for (let index = 0; index < 129; index++) {
    f.text({ id: String(index), method: 'runtime.read' })
  }
  expect(mock.dispatch).toHaveBeenCalledTimes(128)
  expect(f.reply).toHaveBeenCalledOnce()
  expect(JSON.parse(f.reply.mock.calls[0][0]).code).toBe('runtime_busy')
  release()
  await tick()
  f.text({ id: 'after', method: 'runtime.read' })
  expect(mock.dispatch).toHaveBeenCalledTimes(129)
  await tick()
  expect(mock.dispose).toHaveBeenCalledTimes(129)
  f.detach()
})

it('rejects oversized requests before dispatch without consuming capacity', async () => {
  const f = fixture()
  f.text({ id: 'large', method: 'runtime.read', params: { text: 'x'.repeat(4 * 1024 * 1024) } })
  expect(mock.dispatch).not.toHaveBeenCalled()
  expect(JSON.parse(f.reply.mock.calls[0][0]).code).toBe('runtime_busy')
  f.text({ id: 'after', method: 'runtime.read' })
  expect(mock.dispatch).toHaveBeenCalledOnce()
  await tick()
  f.detach()
})

it('rejects connection credential injection and local pairing methods before dispatch', async () => {
  const f = fixture()
  f.text({ id: 'one', method: 'runtime.read', deviceToken: 'forged' })
  f.text({ id: 'two', method: 'pairing.create' })
  f.text({ id: 'three', method: 'cloudRuntime.claim' })
  await tick()
  expect(mock.dispatch).not.toHaveBeenCalled()
  expect(f.reply.mock.calls.map(([raw]) => JSON.parse(raw).code)).toEqual([
    'unauthorized',
    'forbidden',
    'forbidden'
  ])
  f.detach()
})

it('passes the activated account session as creator authority, ignoring payload identity claims', async () => {
  const f = fixture('trusted-session')
  f.text({
    id: 'create',
    method: 'worktree.create',
    params: {
      repo: 'repo-1',
      authenticatedAccountRuntimeSessionId: 'forged-session',
      creatorProvenance: { kind: 'host' }
    }
  })
  await tick()
  expect(mock.dispatch.mock.calls[0]?.[2]).toMatchObject({
    authenticatedAccountRuntimeSessionId: 'trusted-session',
    authenticatedAccountOperationCallerKey: `account-runtime:${'a'.repeat(64)}`
  })
  const authorize = mock.dispatch.mock.calls[0]![2].authorizeRequest
  expect(authorize('agent.launch')).toBe(true)
  expect(authorize('cloudRuntime.claim')).toBe(false)
  expect(authorize('pairing.create')).toBe(false)
  expect(mock.dispatch.mock.calls[0]?.[2]).not.toHaveProperty('pairedDeviceId')
  f.invalidate()
  f.text({ id: 'expired-create', method: 'worktree.create', params: { repo: 'repo-1' } })
  expect(authorize('agent.launch')).toBe(false)
  await tick()
  expect(mock.dispatch).toHaveBeenCalledTimes(1)
  f.detach()
})
