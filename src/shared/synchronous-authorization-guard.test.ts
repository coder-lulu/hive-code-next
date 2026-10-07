import { describe, expect, it, vi } from 'vitest'
import { assertSynchronousAuthorization } from './synchronous-authorization-guard'

describe('mandatory synchronous Host authorization', () => {
  it('accepts synchronous success and preserves an original synchronous denial', () => {
    const refuse = vi.fn((): never => {
      throw new Error('invalid-guard-result')
    })
    expect(assertSynchronousAuthorization(() => undefined, refuse)).toBeUndefined()
    const denied = new Error('current-authority-denied')
    expect(() =>
      assertSynchronousAuthorization(() => {
        throw denied
      }, refuse)
    ).toThrow(denied)
    expect(refuse).not.toHaveBeenCalled()
  })

  it.each([
    ['resolved Promise', () => Promise.resolve()],
    ['object', () => ({ authorized: true })],
    ['false', () => false],
    ['true', () => true],
    ['zero', () => 0],
    ['string', () => 'authorized'],
    ['null', () => null]
  ] as const)('rejects %s in the original synchronous call', (_name, result) => {
    const denied = new Error('invalid-guard-result')
    const refuse = vi.fn((): never => {
      throw denied
    })
    expect(() => assertSynchronousAuthorization(() => result(), refuse)).toThrow(denied)
    expect(refuse).toHaveBeenCalledOnce()
  })

  it('observes a later async denial while refusing immediately', async () => {
    const pending = Promise.withResolvers<void>()
    const denied = new Error('invalid-guard-result')
    expect(() =>
      assertSynchronousAuthorization(
        () => pending.promise,
        (): never => {
          throw denied
        }
      )
    ).toThrow(denied)
    pending.reject(new Error('late-authority-denial'))
    await new Promise<void>((resolve) => setImmediate(resolve))
  })
})
