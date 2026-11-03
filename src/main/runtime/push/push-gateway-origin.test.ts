import { describe, expect, it } from 'vitest'
import { resolvePushGatewayOrigin } from './push-gateway-origin'

describe('product host-key push gateway authority', () => {
  it('has no default upstream gateway', () => {
    expect(resolvePushGatewayOrigin({}, false)).toBeNull()
    expect(resolvePushGatewayOrigin({}, true)).toBeNull()
  })
  it('does not honor a runtime override in packaged builds', () => {
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'https://unapproved.example' }, true)
    ).toBeNull()
  })
  it('allows an explicit development gateway and refuses insecure remote origins', () => {
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'http://127.0.0.1:8000' }, false)
    ).toBe('http://127.0.0.1:8000')
    expect(
      resolvePushGatewayOrigin({ ORCA_PUSH_GATEWAY_URL: 'http://remote.example' }, false)
    ).toBeNull()
  })
})
