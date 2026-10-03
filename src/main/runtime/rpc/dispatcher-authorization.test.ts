import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OrcaRuntimeService } from '../orca-runtime'
import {
  defineMethod,
  defineStreamingMethod,
  type RpcRequest,
  type RpcStreamingHandler
} from './core'
import { RpcDispatcher } from './dispatcher'
import type { RpcDispatchStreamingOptions } from './dispatcher-stream-options'

describe('authenticated remote RPC admission', () => {
  for (const transport of ['unary', 'streaming'] as const) {
    async function dispatch(
      dispatcher: RpcDispatcher,
      request: RpcRequest,
      options: RpcDispatchStreamingOptions
    ) {
      if (transport === 'unary') {
        return dispatcher.dispatch(request, options)
      }
      const replies: string[] = []
      await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), options)
      return JSON.parse(replies[0]!)
    }

    it.each(['missing', 'revoked', 'throws'] as const)(
      `${transport}: rejects %s authority before parsing business content`,
      async (authority) => {
        const parse = vi.fn((value) => value)
        const handler = vi.fn()
        const dispatcher = new RpcDispatcher({
          runtime: { getRuntimeId: () => 'host' } as OrcaRuntimeService,
          methods: [
            defineMethod({ name: 'agent.launch', params: z.unknown().transform(parse), handler })
          ]
        })
        const response = await dispatch(
          dispatcher,
          { id: 'request', authToken: '', method: 'agent.launch', params: { text: 'private' } },
          {
            authenticatedAccountRuntimeSessionId: 'session',
            ...(authority === 'missing'
              ? {}
              : {
                  authorizeRequest: () => {
                    if (authority === 'throws') {
                      throw new Error('private authority detail')
                    }
                    return false
                  }
                })
          }
        )
        expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
        expect(JSON.stringify(response)).not.toContain('private')
        expect(parse).not.toHaveBeenCalled()
        expect(handler).not.toHaveBeenCalled()
      }
    )

    it(`${transport}: rechecks authority after asynchronous routing before the handler`, async () => {
      let current = true
      const handler = vi.fn(() => 'started')
      const dispatcher = new RpcDispatcher({
        runtime: {
          getRuntimeId: () => 'host',
          routeClientHostedBrowserRpc: async () => {
            current = false
            return { handled: false }
          }
        } as unknown as OrcaRuntimeService,
        methods: [defineMethod({ name: 'agent.launch', params: null, handler })]
      })
      const response = await dispatch(
        dispatcher,
        { id: 'request', authToken: '', method: 'agent.launch' },
        { authenticatedAccountRuntimeSessionId: 'session', authorizeRequest: () => current }
      )
      expect(response).toMatchObject({ ok: false, error: { code: 'forbidden' } })
      expect(handler).not.toHaveBeenCalled()
    })
  }

  it('checks registered streaming methods and ignores payload authority claims', async () => {
    const handler = vi.fn<RpcStreamingHandler<unknown>>(async (_params, _ctx, emit) => {
      emit({ ready: true })
    })
    const authorizeRequest = vi.fn(() => true)
    const dispatcher = new RpcDispatcher({
      runtime: { getRuntimeId: () => 'host' } as OrcaRuntimeService,
      methods: [
        defineStreamingMethod({ name: 'nativeChat.subscribe', params: z.unknown(), handler })
      ]
    })
    const replies: string[] = []
    await dispatcher.dispatchStreaming(
      {
        id: 'request',
        authToken: '',
        method: 'nativeChat.subscribe',
        params: { accountId: 'forged' }
      },
      (reply) => replies.push(reply),
      { authenticatedAccountRuntimeSessionId: 'session', authorizeRequest }
    )
    expect(JSON.parse(replies[0]!)).toMatchObject({ ok: true, result: { ready: true } })
    expect(authorizeRequest.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(handler).toHaveBeenCalledOnce()
  })
})
