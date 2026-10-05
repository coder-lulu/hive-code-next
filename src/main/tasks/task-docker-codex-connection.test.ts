import { describe, expect, it, vi } from 'vitest'
import { NDJSON_MAX_LINE_BYTES } from '../../shared/main-process-ndjson-framer'
import type {
  CodexAppServerConnection,
  CodexAppServerConnectionHandlers,
  openCodexAppServerConnection
} from '../codex/codex-app-server-connection'
import {
  CodexAppServerHandshakeExitUnprovenError,
  isCodexAppServerHandshakeExitUnprovenError
} from '../codex/codex-app-server-handshake-exit-proof'
import { openTaskDockerCodexConnection } from './task-docker-codex-connection'

function fixture() {
  let current = true
  const calls: string[] = []
  const prepared = {
    containerId: 'a'.repeat(64),
    launch: {
      command: '/docker',
      args: ['start', '--attach', '--interactive', 'a'.repeat(64)],
      cwd: '/fixture',
      environmentMode: 'replace' as const,
      env: {}
    },
    assertCurrent: vi.fn(() => {
      if (!current) {
        throw new Error('revoked')
      }
    })
  }
  const boundary = {
    prepare: vi.fn(async () => prepared),
    inspect: vi.fn(async () => 'live' as const),
    stop: vi.fn(async () => {
      calls.push('container-stop')
      return true
    })
  }
  const raw: CodexAppServerConnection = {
    pid: 123,
    closed: false,
    request: vi.fn(async () => ({})),
    notify: vi.fn(),
    respond: vi.fn(),
    respondWithError: vi.fn(),
    close: vi.fn(async () => {
      calls.push('transport-close')
      return true
    })
  }
  let handlers: CodexAppServerConnectionHandlers = {}
  const open = vi.fn<typeof openCodexAppServerConnection>(async (_launch, receivedHandlers) => {
    handlers = receivedHandlers ?? {}
    await handlers.onSpawned?.(123)
    return raw
  })
  return {
    boundary,
    prepared,
    raw,
    calls,
    open,
    getHandlers: () => handlers,
    revoke: () => {
      current = false
    }
  }
}

describe('Docker Codex connection', () => {
  it('refuses a concurrent second attach before it can prepare or stop the first connection', async () => {
    const f = fixture()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    f.open.mockImplementation(async () => {
      await pending
      return f.raw
    })
    const results = Promise.allSettled([
      openTaskDockerCodexConnection(f),
      openTaskDockerCodexConnection(f)
    ])
    release()
    const [first, second] = await results
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({
      status: 'rejected',
      reason: new Error('TASK_DOCKER_ATTACH_ALREADY_ADMITTED')
    })
    expect(f.open).toHaveBeenCalledTimes(1)
    expect(f.boundary.prepare).toHaveBeenCalledTimes(1)
    expect(f.boundary.stop).not.toHaveBeenCalled()
    if (first.status !== 'fulfilled') {
      throw first.reason
    }
    await expect(first.value.request('config/read')).resolves.toEqual({})
    await first.value.close()
  })

  it('uses the existing stdio connection and guards each request with the fixed task policy', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f)
    expect(f.open.mock.calls[0][0]).toEqual({
      ...f.prepared.launch,
      maxFrameBytes: NDJSON_MAX_LINE_BYTES
    })
    expect(connection.pid).toBe(123)
    await connection.request('turn/start', {
      threadId: 'owned',
      input: [{ type: 'text', text: 'task' }]
    })
    expect(f.raw.request).toHaveBeenCalledWith(
      'turn/start',
      {
        threadId: 'owned',
        input: [{ type: 'text', text: 'task' }],
        cwd: '/workspace',
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' }
      },
      undefined
    )
    await expect(
      connection.request('turn/start', { sandboxPolicy: { type: 'dangerFullAccess' } })
    ).rejects.toThrow('TASK_DOCKER_POLICY_REFUSED')
    expect(f.raw.request).toHaveBeenCalledTimes(1)
    await expect(connection.close()).resolves.toBe(true)
    expect(f.calls).toEqual(['container-stop', 'transport-close'])
  })

  it('never substitutes a local transport exit for the actual container stop proof', async () => {
    const f = fixture()
    f.boundary.stop.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const connection = await openTaskDockerCodexConnection(f)
    await expect(connection.close()).resolves.toBe(false)
    await expect(connection.close()).resolves.toBe(true)
    expect(f.boundary.stop).toHaveBeenCalledTimes(2)
    expect(connection.closed).toBe(true)
  })

  it('preserves unknown and permits cleanup retries after daemon errors', async () => {
    const f = fixture()
    f.boundary.stop.mockRejectedValueOnce(new Error('daemon unavailable'))
    const connection = await openTaskDockerCodexConnection(f)
    await expect(connection.close()).resolves.toBe(false)
    await expect(connection.close()).resolves.toBe(true)
  })

  it('joins concurrent close requests until both stop barriers settle', async () => {
    const f = fixture()
    let settle!: (value: boolean) => void
    f.boundary.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve
        })
    )
    const connection = await openTaskDockerCodexConnection(f)
    const first = connection.close()
    const second = connection.close()
    expect(first).toBe(second)
    settle(true)
    expect(await first).toBe(true)
    expect(f.boundary.stop).toHaveBeenCalledTimes(1)
    expect(f.raw.close).toHaveBeenCalledTimes(1)
  })

  it('withholds the provider exit callback while the Docker writer may still be live', async () => {
    const f = fixture()
    const onExit = vi.fn()
    f.boundary.stop.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const connection = await openTaskDockerCodexConnection({ ...f, handlers: { onExit } })
    f.getHandlers().onExit?.(new Error('CLI exited'))
    await vi.waitFor(() => expect(f.boundary.stop).toHaveBeenCalledTimes(1))
    expect(onExit).not.toHaveBeenCalled()
    await expect(connection.close()).resolves.toBe(true)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('reports a provider exit only after the exact container was proven stopped', async () => {
    const f = fixture()
    const onExit = vi.fn()
    const connection = await openTaskDockerCodexConnection({ ...f, handlers: { onExit } })
    const failure = new Error('CLI exited')
    f.getHandlers().onExit?.(failure)
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledWith(failure))
    f.getHandlers().onExit?.(failure)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onExit).toHaveBeenCalledTimes(1)
    await connection.close()
  })

  it('fences further RPCs after revocation but retains actual stop authority', async () => {
    const f = fixture()
    const connection = await openTaskDockerCodexConnection(f)
    f.revoke()
    await expect(connection.request('thread/start')).rejects.toThrow('revoked')
    expect(f.raw.request).not.toHaveBeenCalled()
    await expect(connection.close()).resolves.toBe(true)
  })

  it('refuses a revoked attach before opening the Docker transport', async () => {
    const f = fixture()
    f.boundary.prepare.mockImplementationOnce(async () => {
      f.revoke()
      return f.prepared
    })
    await expect(openTaskDockerCodexConnection(f)).rejects.toThrow('revoked')
    expect(f.open).not.toHaveBeenCalled()
  })

  it('retains the same cleanup connection when a failed handshake has no container stop proof', async () => {
    const f = fixture()
    f.open.mockRejectedValueOnce(new Error('bad handshake'))
    f.boundary.stop.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    let failure: unknown
    try {
      await openTaskDockerCodexConnection(f)
    } catch (error) {
      failure = error
    }
    expect(isCodexAppServerHandshakeExitUnprovenError(failure)).toBe(true)
    if (!isCodexAppServerHandshakeExitUnprovenError(failure)) {
      throw failure
    }
    expect(failure.connection.closed).toBe(true)
    await expect(failure.connection.close()).resolves.toBe(true)
    expect(f.boundary.prepare).toHaveBeenCalledTimes(1)
  })

  it('retains an underlying failed-handshake transport until its own exit is proven', async () => {
    const f = fixture()
    f.open.mockRejectedValueOnce(
      new CodexAppServerHandshakeExitUnprovenError(f.raw, new Error('handshake failed'))
    )
    vi.mocked(f.raw.close).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    let failure: unknown
    try {
      await openTaskDockerCodexConnection(f)
    } catch (error) {
      failure = error
    }
    expect(f.raw.close).toHaveBeenCalledTimes(1)
    if (!isCodexAppServerHandshakeExitUnprovenError(failure)) {
      throw failure
    }
    expect(failure.connection).not.toBe(f.raw)
    await expect(failure.connection.close()).resolves.toBe(true)
    expect(f.raw.close).toHaveBeenCalledTimes(2)
    expect(f.boundary.prepare).toHaveBeenCalledTimes(1)
    expect(f.calls.filter((call) => call === 'container-stop')).toHaveLength(2)
  })
})
