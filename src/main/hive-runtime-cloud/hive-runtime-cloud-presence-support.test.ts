import { describe, expect, it } from 'vitest'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from './hive-runtime-cloud-client'
import { isRetryablePresenceError } from './hive-runtime-cloud-presence-support'

describe('Hive Runtime Cloud retry classification', () => {
  it('retries only transport, throttling, and service-unavailable failures', () => {
    expect(isRetryablePresenceError(new HiveRuntimeCloudTransportError())).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(429, null))).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(503, null))).toBe(true)
    expect(isRetryablePresenceError(new HiveRuntimeCloudRequestError(401, null))).toBe(false)
    expect(isRetryablePresenceError(new Error('invalid response'))).toBe(false)
  })
})
