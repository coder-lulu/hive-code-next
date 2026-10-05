import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  finishModelRequest,
  modelBrokerFixture,
  modelStartParams
} from './task-model-broker.test-fixture'

const fixtures: ReturnType<typeof modelBrokerFixture>[] = []
function fixture(overrides: Parameters<typeof modelBrokerFixture>[0] = {}) {
  const result = modelBrokerFixture(overrides)
  fixtures.push(result)
  return result
}

afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.channel.close()
  }
})

const invalidChecks: { name: string; check: () => void }[] = [
  { name: 'pending', check: () => new Promise<void>(() => undefined) },
  { name: 'fulfilled', check: () => Promise.resolve() },
  { name: 'false', check: () => false },
  { name: 'object', check: () => ({ authorized: true }) },
  { name: 'late denial', check: () => Promise.reject(new Error('source-denied')) }
]

describe('model broker original synchronous authority', () => {
  it.each(invalidChecks)('refuses $name before debit or credentials', async ({ check }) => {
    const f = fixture({ assertCurrent: check })
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_AUTHORITY_REVOKED'
    )
    expect(f.reserveDispatch).not.toHaveBeenCalled()
    expect(f.readAuth).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
  })

  it.each(['debit', 'auth'] as const)('refuses a pending original guard after %s', async (edge) => {
    const f = fixture()
    const invalidate = () => {
      f.assertCurrent.mockImplementation(() => Promise.resolve())
    }
    if (edge === 'debit') {
      f.reserveDispatch.mockImplementation(async () => invalidate())
    } else {
      f.readAuth.mockImplementation(async () => {
        invalidate()
        return { Authorization: 'Bearer offline_fixture', 'ChatGPT-Account-Id': 'fixture-account' }
      })
    }
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_AUTHORITY_REVOKED'
    )
    expect(f.reserveDispatch).toHaveBeenCalledTimes(1)
    expect(f.readAuth).toHaveBeenCalledTimes(edge === 'debit' ? 0 : 1)
    expect(f.request).not.toHaveBeenCalled()
  })

  it('refuses revoked streaming authority without reading or returning an event', async () => {
    const f = fixture()
    const params = modelStartParams()
    await f.channel.start(params)
    f.assertCurrent.mockImplementation(() => false)
    await expect(f.channel.next({ requestId: params.requestId, sequence: 0 })).rejects.toThrow(
      'TASK_MODEL_AUTHORITY_REVOKED'
    )
    expect(f.request).toHaveBeenCalledTimes(1)
    await expect(f.channel.start(modelStartParams())).rejects.toThrow(
      'TASK_MODEL_CHANNEL_UNAVAILABLE'
    )
  })

  it('retains successful original synchronous authorization for repeated requests', async () => {
    const check = vi.fn(() => undefined)
    const f = fixture({ assertCurrent: check })
    for (let index = 0; index < 2; index++) {
      const params = modelStartParams()
      await f.channel.start(params)
      await finishModelRequest(f.channel, params.requestId)
    }
    expect(check).toHaveBeenCalled()
    expect(f.reserveDispatch).toHaveBeenCalledTimes(2)
    expect(f.request).toHaveBeenCalledTimes(2)
  })
})
