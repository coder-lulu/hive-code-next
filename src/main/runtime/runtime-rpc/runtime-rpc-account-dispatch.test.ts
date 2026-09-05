import { beforeEach, expect, it, vi } from 'vitest'
import type { RuntimeRpcAccountConnection } from './runtime-rpc-account-dispatch'
type DispatchOptions = {
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
function fixture() {
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
    runtimeSessionId: 'runtime-session-1',
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
    text: (request: object) => text(JSON.stringify(request), reply, sendBinary),
    binary: (bytes: Uint8Array) => binary(bytes)
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

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
