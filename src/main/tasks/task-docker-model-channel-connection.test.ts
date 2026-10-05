import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { openTaskDockerCodexConnection } from './task-docker-codex-connection'
import type { TaskModelChannel } from './task-model-channel-protocol'
import { TASK_MODEL_RPC_ID_PREFIX, TASK_MODEL_RPC_START } from './task-model-channel-protocol'
import type {
  CodexAppServerConnection,
  CodexAppServerConnectionHandlers,
  openCodexAppServerConnection
} from '../codex/codex-app-server-connection'

function fixture() {
  const current = vi.fn()
  const boundary = {
    prepare: vi.fn(async () => ({
      containerId: 'a'.repeat(64),
      launch: {
        command: '/docker',
        args: [],
        cwd: '/fixture',
        env: {},
        environmentMode: 'replace' as const
      },
      assertCurrent: current
    })),
    inspect: vi.fn(async () => 'live' as const),
    stop: vi.fn(async () => true)
  }
  const raw: CodexAppServerConnection = {
    pid: 123,
    closed: false,
    request: vi.fn(async () => ({})),
    notify: vi.fn(),
    respond: vi.fn(),
    respondWithError: vi.fn(),
    close: vi.fn(async () => true)
  }
  let failure: (() => void) | undefined
  const channel: TaskModelChannel = {
    start: vi.fn(async () => ({ status: 200 as const, contentType: 'text/event-stream' as const })),
    next: vi.fn(async () => ({ sequence: 0, bodyBase64: '', done: true })),
    cancel: vi.fn(async () => ({ cancelled: true as const })),
    close: vi.fn(async () => undefined),
    onFailure: vi.fn((listener) => {
      failure = listener
      return () => {
        failure = undefined
      }
    })
  }
  let handlers: CodexAppServerConnectionHandlers = {}
  const open = vi.fn<typeof openCodexAppServerConnection>(async (_launch, received) => {
    handlers = received ?? {}
    return raw
  })
  const onServerRequest = vi.fn(),
    onNotification = vi.fn(),
    onUnhandledFrame = vi.fn(),
    onExit = vi.fn()
  return {
    boundary,
    raw,
    current,
    channel,
    open,
    options: {
      boundary,
      open,
      modelChannel: channel,
      handlers: { onServerRequest, onNotification, onUnhandledFrame, onExit }
    },
    handlers: () => handlers,
    fail: () => failure?.(),
    onServerRequest,
    onNotification,
    onUnhandledFrame,
    onExit
  }
}
const privateId = () => `${TASK_MODEL_RPC_ID_PREFIX}${randomUUID()}-0`
const privateStart = () => ({
  id: privateId(),
  method: TASK_MODEL_RPC_START,
  params: { requestId: randomUUID(), bodyBase64: 'e30=' }
})

describe('Docker model channel integration', () => {
  it('fences ordinary requests synchronously when the model channel fails', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f.options)
    f.fail()
    const request = connection.request('command/exec', { command: ['/bin/sh', '-c', 'true'] })
    expect(f.raw.request).not.toHaveBeenCalled()
    expect(connection.closed).toBe(true)
    expect(f.onExit).not.toHaveBeenCalled()
    await expect(request).rejects.toThrow('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
    await expect(connection.close()).resolves.toBe(true)
    expect(f.onExit).toHaveBeenCalledTimes(1)
  })

  it('fences ordinary notifications and replies before failure cleanup runs', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f.options)
    f.fail()
    expect(() => connection.notify('turn/start', {})).toThrow('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
    expect(() => connection.respond(7, {})).toThrow('TASK_DOCKER_TRANSPORT_UNAVAILABLE')
    expect(() => connection.respondWithError(8, 1, 'fixture')).toThrow(
      'TASK_DOCKER_TRANSPORT_UNAVAILABLE'
    )
    expect(f.raw.notify).not.toHaveBeenCalled()
    expect(f.raw.respond).not.toHaveBeenCalled()
    expect(f.raw.respondWithError).not.toHaveBeenCalled()
    expect(f.onExit).not.toHaveBeenCalled()
    await expect(connection.close()).resolves.toBe(true)
  })

  it('cleans up a channel that reports failure synchronously before transport launch', async () => {
    const f = fixture()
    vi.mocked(f.channel.onFailure).mockImplementation((listener) => {
      listener()
      return () => undefined
    })
    await expect(openTaskDockerCodexConnection(f.options)).rejects.toThrow(
      'TASK_DOCKER_TRANSPORT_UNAVAILABLE'
    )
    expect(f.open).not.toHaveBeenCalled()
    expect(f.boundary.stop).toHaveBeenCalledTimes(1)
    expect(f.channel.close).toHaveBeenCalledTimes(1)
  })

  it('routes private model requests only to the Host broker and keeps ordinary callbacks', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f.options)
    const request = privateStart()
    f.handlers().onServerRequest?.(request)
    await vi.waitFor(() =>
      expect(f.raw.respond).toHaveBeenCalledWith(request.id, {
        status: 200,
        contentType: 'text/event-stream'
      })
    )
    expect(f.channel.start).toHaveBeenCalledWith(request.params)
    expect(f.onServerRequest).not.toHaveBeenCalled()
    const ordinary = { id: 7, method: 'item/tool/requestUserInput', params: {} }
    f.handlers().onServerRequest?.(ordinary)
    f.handlers().onNotification?.('turn/completed', {})
    expect(f.onServerRequest).toHaveBeenCalledWith(ordinary)
    expect(f.onNotification).toHaveBeenCalledWith('turn/completed', {})
    await connection.close()
    expect(f.channel.close).toHaveBeenCalled()
  })

  it.each([
    { ...privateStart(), id: 'hive-model-invalid' },
    { ...privateStart(), method: 'hive/model/foreign' },
    { ...privateStart(), id: 1 }
  ])('consumes refused private frames and stops the original container %#', async (request) => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f.options)
    f.handlers().onServerRequest?.(request)
    await vi.waitFor(() => expect(f.boundary.stop).toHaveBeenCalled())
    expect(f.channel.start).not.toHaveBeenCalled()
    expect(f.onServerRequest).not.toHaveBeenCalled()
    await connection.close()
  })

  it.each(['replay', 'gap', 'foreign-nonce', 'noncanonical-counter'])(
    'refuses %s after a completed private correlation',
    async (kind) => {
      const f = fixture()
      const connection = await openTaskDockerCodexConnection(f.options)
      const first = privateStart()
      f.handlers().onServerRequest?.(first)
      await vi.waitFor(() => expect(f.raw.respond).toHaveBeenCalledTimes(1))
      const id =
        kind === 'foreign-nonce'
          ? privateId().replace(/-0$/, '-1')
          : first.id.replace(/-0$/, kind === 'replay' ? '-0' : kind === 'gap' ? '-2' : '-01')
      f.handlers().onServerRequest?.({ ...first, id })
      expect(connection.closed).toBe(true)
      await expect(connection.close()).resolves.toBe(true)
      expect(f.channel.start).toHaveBeenCalledTimes(1)
      expect(f.raw.respond).toHaveBeenCalledTimes(1)
      expect(f.onServerRequest).not.toHaveBeenCalled()
    }
  )

  it('refuses private notification and unhandled response envelopes without leaking to product callbacks', async () => {
    for (const kind of ['notification', 'unhandled']) {
      const f = fixture()
      const connection = await openTaskDockerCodexConnection(f.options)
      if (kind === 'notification') {
        f.handlers().onNotification?.(TASK_MODEL_RPC_START, {})
      } else {
        f.handlers().onUnhandledFrame?.('frame:unclassified', { id: privateId(), result: {} })
      }
      await vi.waitFor(() => expect(f.boundary.stop).toHaveBeenCalled())
      expect(f.onNotification).not.toHaveBeenCalled()
      expect(f.onUnhandledFrame).not.toHaveBeenCalled()
      await connection.close()
    }
  })

  it('does not settle a failed model transport until exact container and transport exit are proven', async () => {
    const f = fixture()
    f.boundary.stop.mockResolvedValueOnce(false).mockResolvedValue(true)
    const connection = await openTaskDockerCodexConnection(f.options)
    f.fail()
    await vi.waitFor(() => expect(f.raw.close).toHaveBeenCalledTimes(1))
    expect(f.onExit).not.toHaveBeenCalled()
    await expect(connection.close()).resolves.toBe(true)
    expect(f.onExit).toHaveBeenCalledTimes(1)
    expect(f.onExit).toHaveBeenCalledWith(new Error('TASK_MODEL_CHANNEL_UNAVAILABLE'))
  })

  it('aborts the model channel on unexpected transport exit before reporting stopped writers', async () => {
    const f = fixture()
    let stopped!: (value: boolean) => void
    f.boundary.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stopped = resolve
        })
    )
    const connection = await openTaskDockerCodexConnection(f.options)
    const error = new Error('unexpected transport exit')
    f.handlers().onExit?.(error)
    expect(f.channel.close).toHaveBeenCalledTimes(1)
    expect(f.onExit).not.toHaveBeenCalled()
    stopped(true)
    await vi.waitFor(() => expect(f.onExit).toHaveBeenCalledWith(error))
    await connection.close()
  })

  it('discards a late model reply after authority revocation and stops the container', async () => {
    const f = fixture()
    let resolve!: (value: { status: 200; contentType: 'text/event-stream' }) => void
    vi.mocked(f.channel.start).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const connection = await openTaskDockerCodexConnection(f.options)
    f.handlers().onServerRequest?.(privateStart())
    await vi.waitFor(() => expect(f.channel.start).toHaveBeenCalledTimes(1))
    f.current.mockImplementation(() => {
      throw new Error('revoked')
    })
    resolve({ status: 200, contentType: 'text/event-stream' })
    await vi.waitFor(() => expect(f.boundary.stop).toHaveBeenCalled())
    expect(f.raw.respond).not.toHaveBeenCalled()
    await connection.close()
  })

  it('prevents callers from answering private model IDs through the ordinary response API', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f.options)
    expect(() => connection.respond(privateId(), {})).toThrow('TASK_DOCKER_POLICY_REFUSED')
    expect(() => connection.respondWithError(privateId(), 1, 'override')).toThrow(
      'TASK_DOCKER_POLICY_REFUSED'
    )
    expect(f.raw.respond).not.toHaveBeenCalled()
    expect(f.raw.respondWithError).not.toHaveBeenCalled()
    await connection.close()
  })

  it('closes the channel on original prepare failure without launching a fallback', async () => {
    const f = fixture()
    f.boundary.prepare.mockRejectedValue(new Error('prepare failed'))
    await expect(openTaskDockerCodexConnection(f.options)).rejects.toThrow('prepare failed')
    expect(f.channel.close).toHaveBeenCalledTimes(1)
    expect(f.open).not.toHaveBeenCalled()
  })
})
