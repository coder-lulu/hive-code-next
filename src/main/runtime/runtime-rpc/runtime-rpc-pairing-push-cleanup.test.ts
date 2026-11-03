import { describe, expect, it, vi } from 'vitest'
import { RuntimeRpcPairing } from './runtime-rpc-pairing'

describe('mobile revocation cleanup on the active pairing owner', () => {
  it.each([false, true])(
    'revokes local access even when gateway cleanup fails=%s',
    async (failCleanup) => {
      const events: string[] = []
      const enqueue = vi.fn(() => {
        events.push('persist')
        if (failCleanup) {
          throw new Error('disk unavailable')
        }
      })
      const context = {
        deviceRegistry: {
          getDevice: () => ({
            scope: 'mobile',
            deviceId: 'phone',
            pushRegistration: { registrationId: 'gateway-token' }
          }),
          removeDevice: vi.fn(() => {
            events.push('revoke')
            return true
          })
        },
        getPushUnregisterOutbox: () => ({ enqueue }),
        onPushUnregisterQueued: vi.fn(),
        runtime: { forgetClientNavigationState: vi.fn() },
        mobileSocketWiring: { terminateDeviceConnections: vi.fn() }
      }
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(
          await RuntimeRpcPairing.prototype.revokeMobileDevice.call(context as never, 'phone')
        ).toBe(true)
        expect(enqueue).toHaveBeenCalledWith({ deviceId: 'phone', registrationId: 'gateway-token' })
        expect(events).toEqual(['persist', 'revoke'])
        expect(context.mobileSocketWiring.terminateDeviceConnections).toHaveBeenCalledWith('phone')
        expect(context.onPushUnregisterQueued).toHaveBeenCalledTimes(failCleanup ? 0 : 1)
      } finally {
        error.mockRestore()
      }
    }
  )
})
