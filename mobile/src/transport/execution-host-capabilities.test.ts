import { describe, expect, it } from 'vitest'
import { MOBILE_RUNTIME_CAPABILITIES } from '../../../src/shared/mobile-runtime-capabilities'
import { workspaceRouteExecutionHost } from './execution-host-scoped-rpc-client'
import { MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY } from '../../../src/shared/mobile-desktop-relay-contract'
import type { RpcClient } from './rpc-client'

describe('current runtime routing capabilities', () => {
  it('does not advertise the retired relay or delegated-device graph', () => {
    expect(MOBILE_RUNTIME_CAPABILITIES).not.toContain(MOBILE_DESKTOP_RELAY_RUNTIME_CAPABILITY)
    expect(
      MOBILE_RUNTIME_CAPABILITIES.some((capability) => /relay|delegated/.test(capability))
    ).toBe(false)
  })
  it('refuses a remote workspace when the current runtime cannot forward it', () => {
    const client = { carriesRpcEnvelope: () => true } as RpcClient
    expect(
      workspaceRouteExecutionHost(client, MOBILE_RUNTIME_CAPABILITIES, 'runtime:other')
    ).toBeNull()
  })
  it('keeps the local workspace on the direct runtime', () => {
    expect(
      workspaceRouteExecutionHost(null, MOBILE_RUNTIME_CAPABILITIES, undefined)
    ).toBeUndefined()
  })
})
