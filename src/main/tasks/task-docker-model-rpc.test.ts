import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTaskDockerModelRpc, type TaskDockerModelRpc } from './task-docker-model-rpc'
import {
  TASK_MODEL_RPC_ID_PREFIX,
  TASK_MODEL_RPC_NEXT,
  TASK_MODEL_RPC_START,
  TASK_MODEL_RPC_TIMEOUT_MS
} from './task-model-channel-protocol'

const opened: TaskDockerModelRpc[] = []
afterEach(async () => {
  await Promise.all(opened.splice(0).map((rpc) => rpc.close()))
  vi.useRealTimers()
})
function fixture(write = vi.fn(async (_line: string): Promise<void> => undefined)) {
  const onFailure = vi.fn()
  const rpc = createTaskDockerModelRpc({ write, onFailure })
  opened.push(rpc)
  const sent = () => JSON.parse(write.mock.calls.at(-1)![0])
  return { rpc, write, onFailure, sent }
}

describe('private guest model RPC', () => {
  it('correlates out-of-order replies while emitting consecutive private IDs', async () => {
    const f = fixture()
    const first = f.rpc.request(TASK_MODEL_RPC_START, {})
    const firstId = f.sent().id
    const second = f.rpc.request(TASK_MODEL_RPC_NEXT, {})
    const secondId = f.sent().id
    expect(secondId).toBe(firstId.replace(/-0$/, '-1'))
    expect(f.rpc.handleResponse({ id: secondId, result: 'second' })).toBe(true)
    expect(f.rpc.handleResponse({ id: firstId, result: 'first' })).toBe(true)
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it('uses complete correlated frames and frees the bounded pending slot on response', async () => {
    const f = fixture()
    const a = f.rpc.request(TASK_MODEL_RPC_START, { requestId: 'synthetic', bodyBase64: 'e30=' })
    const first = f.sent()
    expect(first.id).toMatch(new RegExp(`^${TASK_MODEL_RPC_ID_PREFIX}[0-9a-f-]{36}-0$`))
    expect(first.jsonrpc).toBe('2.0')
    expect(f.write.mock.calls[0]![0].split('\n')).toHaveLength(2)
    expect(f.rpc.handleResponse({ id: first.id, result: { status: 200 } })).toBe(true)
    await expect(a).resolves.toEqual({ status: 200 })
    const b = f.rpc.request(TASK_MODEL_RPC_NEXT, { requestId: 'synthetic', sequence: 0 })
    expect(f.sent().id).toBe(first.id.replace(/-0$/, '-1'))
    f.rpc.handleResponse({ jsonrpc: '2.0', id: f.sent().id, result: 'next' })
    await expect(b).resolves.toBe('next')
    expect(f.onFailure).not.toHaveBeenCalled()
  })

  it.each([
    (id: string) => ({ id, result: {}, error: { code: 1, message: 'hidden' } }),
    (id: string) => ({ id, result: {}, method: 'initialize' }),
    (id: string) => ({ id, result: {}, jsonrpc: '1.0' }),
    (id: string) => ({ id, error: { code: 1.5, message: 'hidden' } }),
    (_id: string) => ({ id: `${TASK_MODEL_RPC_ID_PREFIX}unknown`, result: {} })
  ])('consumes and fails malformed or unknown private responses', async (frame) => {
    const f = fixture()
    const result = f.rpc.request(TASK_MODEL_RPC_START, {})
    const rejected = expect(result).rejects.toThrow('TASK_MODEL_RPC_FAILED')
    expect(f.rpc.handleResponse(frame(f.sent().id))).toBe(true)
    await rejected
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    await expect(f.rpc.request(TASK_MODEL_RPC_NEXT, {})).rejects.toThrow('TASK_MODEL_RPC_FAILED')
  })

  it('never reflects host error text and rejects replay of a completed private ID', async () => {
    const f = fixture()
    const promise = f.rpc.request(TASK_MODEL_RPC_START, {})
    const id = f.sent().id
    f.rpc.handleResponse({ id, error: { code: -1, message: 'synthetic-account-token' } })
    await expect(promise).rejects.toThrow(/^TASK_MODEL_RPC_FAILED$/)
    expect(f.rpc.handleResponse({ id, result: {} })).toBe(true)
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    expect(f.rpc.handleResponse({ id: 1, result: {} })).toBe(false)
  })

  it('has no unbounded request queue and terminates all pending callers on overflow', async () => {
    const f = fixture()
    const pending = [
      f.rpc.request(TASK_MODEL_RPC_START, {}),
      f.rpc.request(TASK_MODEL_RPC_NEXT, {})
    ]
    const all = Promise.allSettled(pending)
    await expect(f.rpc.request(TASK_MODEL_RPC_NEXT, {})).rejects.toThrow('TASK_MODEL_RPC_FAILED')
    expect((await all).map((value) => value.status)).toEqual(['rejected', 'rejected'])
    expect(f.write).toHaveBeenCalledTimes(2)
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('times out and releases every pending entry', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const rejected = expect(f.rpc.request(TASK_MODEL_RPC_START, {})).rejects.toThrow(
      'TASK_MODEL_RPC_FAILED'
    )
    await vi.advanceTimersByTimeAsync(TASK_MODEL_RPC_TIMEOUT_MS)
    await rejected
    expect(f.onFailure).toHaveBeenCalledTimes(1)
  })

  it('fails closed on write errors and closes without waiting for a stuck write', async () => {
    const f = fixture(
      vi.fn(async (_line: string) => {
        throw new Error('synthetic-secret')
      })
    )
    await expect(f.rpc.request(TASK_MODEL_RPC_START, {})).rejects.toThrow(/^TASK_MODEL_RPC_FAILED$/)
    expect(f.onFailure).toHaveBeenCalledTimes(1)
    const stuck = fixture(vi.fn((_line: string) => new Promise<void>(() => undefined)))
    const rejected = expect(stuck.rpc.request(TASK_MODEL_RPC_START, {})).rejects.toThrow(
      'TASK_MODEL_RPC_FAILED'
    )
    await stuck.rpc.close()
    await rejected
    expect(stuck.onFailure).not.toHaveBeenCalled()
  })

  it('refuses arbitrary RPC methods without emitting a provider frame', async () => {
    const f = fixture()
    await expect(f.rpc.request('command/exec', {})).rejects.toThrow('TASK_MODEL_RPC_FAILED')
    expect(f.write).not.toHaveBeenCalled()
  })
})
