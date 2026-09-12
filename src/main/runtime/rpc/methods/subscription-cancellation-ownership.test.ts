import { expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RuntimeSubscriptionRegistry } from '../../runtime-subscription-registry'
import { eraseRpcMethods, isStreamingMethod } from '../core'
import { ACCOUNT_METHODS } from './accounts'
import { FILE_METHODS } from './files'
import { BROWSER_SCREENCAST_METHODS } from './browser-screencast'
vi.mock('../../runtime-browser-commands-factory', () => ({
  runtimeBrowserCommandsFactoryIsAvailable: () => true
}))

it.each(['accounts.unsubscribe', 'files.unwatch', 'browser.screencast.unsubscribe'])(
  '%s cancels only its connection subscription and leaves local behavior intact',
  async (name) => {
    const method = eraseRpcMethods([
      ...ACCOUNT_METHODS,
      ...FILE_METHODS,
      ...BROWSER_SCREENCAST_METHODS
    ]).find((item) => item.name === name)!
    if (isStreamingMethod(method)) {
      throw new Error('expected request')
    }
    const registry = new RuntimeSubscriptionRegistry()
    const first = vi.fn()
    const second = vi.fn()
    registry.register('subscription-first', first, 'connection-first')
    registry.register('subscription-second', second, 'connection-second')
    const runtime = {
      cleanupSubscription: registry.cleanup.bind(registry),
      cleanupSubscriptionAndWait: registry.cleanupAndWait.bind(registry),
      cleanupSubscriptionIfOwnedByConnection: registry.cleanupIfOwnedByConnection.bind(registry),
      cleanupSubscriptionAndWaitIfOwnedByConnection:
        registry.cleanupAndWaitIfOwnedByConnection.bind(registry)
    } as unknown as OrcaRuntimeService
    expect(
      await method.handler(
        { subscriptionId: 'subscription-second' },
        { runtime, connectionId: 'connection-first' }
      )
    ).toEqual({ unsubscribed: false })
    expect(second).not.toHaveBeenCalled()
    expect(
      await method.handler(
        { subscriptionId: 'subscription-first' },
        { runtime, connectionId: 'connection-first' }
      )
    ).toEqual({ unsubscribed: true })
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(await method.handler({ subscriptionId: 'subscription-second' }, { runtime })).toEqual({
      unsubscribed: true
    })
    expect(second).toHaveBeenCalledOnce()
  }
)
