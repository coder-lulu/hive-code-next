import { describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayPool } from '../../../src/shared/hive-account-relay-pool'
import type { RuntimeRpcResponse } from '../../../src/shared/runtime-rpc-envelope'
import { AccountRuntimeRpcRequests } from './account-runtime-rpc-requests'
import type { AccountRuntimeStream } from './account-runtime-rpc-stream'

const response = { id: 'reply', ok: true as const, result: {}, _meta: { runtimeId: 'host' } }
function fixture() {
  const request = vi.fn().mockResolvedValue(response)
  const pool = { request } as unknown as HiveAccountRelayPool
  const makeStream = (terminal: string): AccountRuntimeStream => ({
    method: 'terminal.subscribe',
    params: { terminal, client: { id: 'phone' } },
    listener: vi.fn(),
    options: undefined,
    generation: 1,
    retryAttempt: 0,
    retryTimer: null,
    physical: {
      close: vi.fn(),
      sendBinary: vi.fn(),
      sendRequest: vi.fn().mockResolvedValue(response)
    }
  })
  return {
    request,
    pool,
    first: makeStream('one'),
    second: makeStream('two'),
    rpc: new AccountRuntimeRpcRequests()
  }
}

describe('account terminal channel ownership', () => {
  it('routes terminal operations to their stream while ordinary RPC uses the main channel', async () => {
    const { rpc, pool, request, first, second } = fixture()
    for (const method of [
      'terminal.send',
      'terminal.focus',
      'terminal.updateViewport',
      'terminal.resizeForClient',
      'terminal.setDisplayMode',
      'terminal.restoreFit'
    ]) {
      await rpc.request(
        pool,
        [first, second],
        method,
        { terminal: 'two', inputKind: 'query-reply' },
        1200
      )
    }
    await rpc.request(pool, [first, second], 'terminal.unsubscribe', {
      subscriptionId: 'two:phone'
    })
    expect(second.physical!.sendRequest).toHaveBeenCalledTimes(7)
    expect(first.physical!.sendRequest).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    await rpc.request(pool, [first, second], 'status.get', {})
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects orphan replies and closed stream writes without falling back or replaying', async () => {
    const { rpc, pool, request, first } = fixture()
    await expect(
      rpc.request(pool, [], 'terminal.send', { terminal: 'one', inputKind: 'query-reply' })
    ).rejects.toThrow('subscription is unavailable')
    const physical = first.physical!
    vi.mocked(physical.sendRequest).mockRejectedValueOnce(new Error('socket closed'))
    await expect(
      rpc.request(pool, [first], 'terminal.send', { terminal: 'one', text: 'hello' })
    ).rejects.toThrow('socket closed')
    expect(physical.sendRequest).toHaveBeenCalledTimes(1)
    first.physical = null
    await expect(
      rpc.request(pool, [first], 'terminal.send', { terminal: 'one', text: 'hello' })
    ).rejects.toThrow('subscription is unavailable')
    expect(request).not.toHaveBeenCalled()
  })

  it('retains pending limits and rejects completions from a replaced attachment', async () => {
    const { rpc, pool, request, first } = fixture()
    let finish!: (value: RuntimeRpcResponse<unknown>) => void
    const pending = new Promise<RuntimeRpcResponse<unknown>>((resolve) => {
      finish = resolve
    })
    vi.mocked(first.physical!.sendRequest).mockReturnValue(pending)
    const writes = Array.from({ length: 64 }, () =>
      rpc.request(pool, [first], 'terminal.send', { terminal: 'one', text: 'x' })
    )
    await expect(rpc.request(pool, [first], 'terminal.send', { terminal: 'one' })).rejects.toThrow(
      'request limit'
    )
    first.generation++
    finish(response)
    const results = await Promise.allSettled(writes)
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(request).not.toHaveBeenCalled()
    await expect(rpc.request(pool, [], 'status.get', {})).resolves.toMatchObject({ ok: true })
  })
})
