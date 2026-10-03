import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import { OrcaRuntimeService } from '../../orca-runtime'
import { NOTIFICATION_METHODS } from './notifications'

describe('Hive push test availability', () => {
  it('returns the HiveCloud push sink outcome without a registerPush RPC', async () => {
    const runtime = new OrcaRuntimeService()
    const testMobileNotificationRemotePush = vi
      .spyOn(runtime, 'testMobileNotificationRemotePush')
      .mockResolvedValue({ accepted: false, reason: 'not_registered' })
    const dispatcher = new RpcDispatcher({ runtime, methods: NOTIFICATION_METHODS })
    const result = await dispatcher.dispatch({
      id: 'push-test',
      authToken: 'test',
      method: 'notifications.testPush',
      params: null
    })
    expect(result).toMatchObject({
      ok: true,
      result: { accepted: false, reason: 'not_registered' }
    })
    expect(testMobileNotificationRemotePush).toHaveBeenCalledOnce()
    expect(NOTIFICATION_METHODS.map(({ name }) => name)).not.toContain('notifications.registerPush')
  })
})
