import { describe, expect, expectTypeOf, it } from 'vitest'
import type { RuntimeRpcFailure } from '../../../src/shared/runtime-rpc-envelope'
import { isRpcResponse } from './rpc-response-shape'
import type { RpcFailure } from './types'

describe('isRpcResponse', () => {
  it('accepts the shared failure envelope before a runtime identity is available', () => {
    expectTypeOf<RuntimeRpcFailure>().toExtend<RpcFailure>()
    const failure: RuntimeRpcFailure = {
      id: 'rpc-1',
      ok: false,
      error: { code: 'unavailable', message: 'Runtime unavailable' },
      _meta: { runtimeId: null }
    }
    expect(isRpcResponse(failure)).toBe(true)
  })

  it('requires success responses to include a result field', () => {
    expect(isRpcResponse({ id: 'rpc-1', ok: true, result: null })).toBe(true)
    expect(isRpcResponse({ id: 'rpc-1', ok: true })).toBe(false)
  })

  it('requires failure responses to include code and message', () => {
    expect(
      isRpcResponse({
        id: 'rpc-1',
        ok: false,
        error: { code: 'failed', message: 'Nope' }
      })
    ).toBe(true)
    expect(isRpcResponse({ id: 'rpc-1', ok: false, error: { code: 'failed' } })).toBe(false)
  })

  it('accepts additive future fields without weakening known-field validation', () => {
    expect(
      isRpcResponse({
        id: 'rpc-1',
        ok: true,
        result: { value: 1 },
        futureEnvelopeField: true
      })
    ).toBe(true)
    expect(
      isRpcResponse({
        id: 'rpc-1',
        ok: false,
        error: { code: 500, message: 'Nope', futureErrorField: true },
        futureEnvelopeField: true
      })
    ).toBe(false)
  })
})
