import { describe, expect, it } from 'vitest'
import {
  deserializeNodeRuntimeMessage,
  serializeNodeRuntimeMessage
} from './vitest-node-runtime-codec.mjs'

describe('Node runtime RPC error transport', () => {
  it('retains an actual module rejection and its non-enumerable diagnostics', () => {
    const cause = new TypeError('module resolution failed')
    const error = Object.assign(new Error('Failed to load URL missing-module.ts', { cause }), {
      code: 'ERR_MODULE_NOT_FOUND'
    })
    const result = deserializeNodeRuntimeMessage(serializeNodeRuntimeMessage({ t: 's', e: error }))
    expect(result.e).toBeInstanceOf(Error)
    expect(result.e.name).toBe(error.name)
    expect(result.e.message).toBe(error.message)
    expect(result.e.stack).toBe(error.stack)
    expect(result.e.code).toBe(error.code)
    expect(result.e.cause).toBeInstanceOf(Error)
    expect(result.e.cause.name).toBe('TypeError')
    expect(result.e.cause.message).toBe(cause.message)
    expect(result.e.cause.stack).toBe(cause.stack)
  })

  it('preserves shared and cyclic Error causes alongside RegExp filters', () => {
    const error = new Error('cyclic rejection')
    error.cause = error
    const request = { e: error, repeated: error, filter: /missing-module/gi }
    request.self = request
    const result = deserializeNodeRuntimeMessage(serializeNodeRuntimeMessage(request))
    expect(result.self).toBe(result)
    expect(result.e).toBeInstanceOf(Error)
    expect(result.e.cause).toBe(result.e)
    expect(result.repeated).toBe(result.e)
    expect(result.filter).toBeInstanceOf(RegExp)
    expect(result.filter.source).toBe('missing-module')
    expect(result.filter.flags).toBe('gi')
  })

  it('keeps non-Error rejections and refuses invalid transport input', () => {
    expect(deserializeNodeRuntimeMessage(serializeNodeRuntimeMessage({ e: 'rejected' }))).toEqual({
      e: 'rejected'
    })
    expect(() => deserializeNodeRuntimeMessage({ e: 'rejected' })).toThrow(
      'Invalid Node Vitest worker message'
    )
    expect(() => deserializeNodeRuntimeMessage('not-json')).toThrow()
  })
})
