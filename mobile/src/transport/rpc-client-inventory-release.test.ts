import '../../../src/main/runtime/rpc/unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../../../src/main/runtime/rpc/dispatcher'
import { SESSION_TAB_METHODS } from '../../../src/main/runtime/rpc/methods/session-tabs'
import { RuntimeSubscriptionRegistry } from '../../../src/main/runtime/runtime-subscription-registry'
import type { RpcRequest } from '../../../src/main/runtime/rpc/core'
import { RpcClientStreamRegistry } from './rpc-client-stream-registry'
import type { RpcResponse } from './types'

describe('direct session-tab inventory release', () => {
  it.each([false, true])(
    'cleans only its host listener after initial census=%s',
    async (delivered) => {
      const hostSubscriptions = new RuntimeSubscriptionRegistry()
      const stopOlder = vi.fn()
      const stopNewer = vi.fn()
      let completeOlder!: (value: {
        snapshots: []
        authoritative: true
        changeSequence: number
      }) => void
      let startedOlder!: () => void
      const olderStarted = new Promise<void>((resolve) => {
        startedOlder = resolve
      })
      const olderCensus = new Promise<{
        snapshots: []
        authoritative: true
        changeSequence: number
      }>((resolve) => {
        completeOlder = resolve
      })
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the real explicit session-tab registry reaches only these runtime members; missing access fails the test.
      const runtime = {
        getRuntimeId: () => 'runtime-inventory',
        supportsAuthoritativeSessionTabsInventory: () => true,
        listAllMobileSessionTabsInventoryWithChangeSequence: vi
          .fn()
          .mockImplementationOnce(() => {
            startedOlder()
            return olderCensus
          })
          .mockResolvedValue({ snapshots: [], authoritative: true, changeSequence: 0 }),
        onMobileSessionTabsChanged: vi
          .fn()
          .mockReturnValueOnce(stopOlder)
          .mockReturnValueOnce(stopNewer),
        registerSubscriptionCleanup: hostSubscriptions.register.bind(hostSubscriptions),
        cleanupSubscription: hostSubscriptions.cleanup.bind(hostSubscriptions)
      } as unknown as ConstructorParameters<typeof RpcDispatcher>[0]['runtime']
      const dispatcher = new RpcDispatcher({ runtime, methods: SESSION_TAB_METHODS })
      const sent: RpcRequest[] = []
      let nextId = 0
      const client = new RpcClientStreamRegistry({
        nextId: () => `inventory-${++nextId}`,
        deviceToken: 'test-device',
        getState: () => 'connected',
        sendEncrypted: (request) => {
          sent.push(request as RpcRequest)
          return true
        }
      })
      const olderEvents: unknown[] = []
      const newerEvents: unknown[] = []
      const disposeOlder = client.subscribe('session.tabs.subscribeAll', null, (event) =>
        olderEvents.push(event)
      )
      const disposeNewer = client.subscribe('session.tabs.subscribeAll', null, (event) =>
        newerEvents.push(event)
      )
      const [older, newer] = sent
      const deliver = (message: string) => {
        const response: RpcResponse = JSON.parse(message)
        client.handleResponse(response)
      }
      const options = { connectionId: 'owned-direct-connection' }
      const pendingOlder = dispatcher.dispatchStreaming(older!, deliver, options)
      await olderStarted
      const census = { snapshots: [] as [], authoritative: true as const, changeSequence: 0 }
      if (delivered) {
        completeOlder(census)
        await pendingOlder
      }
      await dispatcher.dispatchStreaming(newer!, deliver, options)
      expect(stopOlder).not.toHaveBeenCalled()
      expect(stopNewer).not.toHaveBeenCalled()

      disposeOlder()
      disposeOlder()

      const releases = sent.filter((request) => request.method === 'session.tabs.unsubscribeAll')
      expect(releases).toHaveLength(1)
      expect(releases[0]!.params).toEqual({ subscriptionId: older!.id })
      expect(await dispatcher.dispatch(releases[0]!, options)).toMatchObject({
        ok: true,
        result: { unsubscribed: true }
      })
      expect(stopOlder).toHaveBeenCalledTimes(1)
      expect(stopNewer).not.toHaveBeenCalled()
      if (!delivered) {
        completeOlder(census)
        await pendingOlder
      }
      client.handleResponse({
        id: older!.id,
        ok: true,
        streaming: true,
        result: { type: 'snapshots', snapshots: [] }
      })
      client.handleResponse({ id: older!.id, ok: true, streaming: true, result: { type: 'end' } })
      expect(olderEvents).toEqual(delivered ? [{ type: 'snapshots', snapshots: [] }] : [])
      expect(newerEvents).toEqual([{ type: 'snapshots', snapshots: [] }])
      expect(client.size()).toBe(1)
      expect(
        sent.filter((request) => request.method === 'session.tabs.unsubscribeAll')
      ).toHaveLength(1)

      disposeNewer()
      expect(sent.at(-1)).toMatchObject({
        method: 'session.tabs.unsubscribeAll',
        params: { subscriptionId: newer!.id }
      })
      await dispatcher.dispatch(sent.at(-1)!, options)
      expect(stopNewer).toHaveBeenCalledTimes(1)
      expect(client.size()).toBe(0)
    }
  )
})
