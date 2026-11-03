import { describe, expect, it } from 'vitest'
import { validateRelayHello } from './hive-account-relay-channel-protocol'

const binding = { cellId: 'cell', cellIncarnationId: 'incarnation' }
const hello = { type: 'relay-hello', v: 2, connId: 'connection', ...binding }

describe('account relay hello binding', () => {
  it('requires the exact current cell and incarnation envelope', () => {
    expect(validateRelayHello(JSON.stringify(hello), binding)).toBe(true)
    expect(validateRelayHello(JSON.stringify({ ...hello, cellId: 'other' }), binding)).toBe(false)
    expect(
      validateRelayHello(JSON.stringify({ ...hello, cellIncarnationId: 'old' }), binding)
    ).toBe(false)
  })

  it.each([
    { ...hello, cellUrl: 'https://untrusted.example' },
    { ...hello, acceptedAs: 'grace' },
    { ...hello, connId: '' },
    { type: 'relay-hello', ok: false, code: 4404 },
    { type: 'relay-hello', ok: true, credentialKind: 'invite', leaseExpiresAt: 1 }
  ])('refuses extra fields, invalid identity and retired phone envelopes: %j', (value) => {
    expect(validateRelayHello(JSON.stringify(value), binding)).toBe(false)
  })
})
