import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakes = vi.hoisted(() => ({
  options: null as null | {
    credential: unknown
    expectedCredentialKind: string
    deviceToken: string
    onHello(value: { credentialKind: string; leaseExpiresAt: number }): void
    onAuthenticated(): void
    onText(value: string): void
    onBinary(value: Uint8Array): void
    onError(error: Error): void
  },
  sendText: vi.fn(() => true),
  close: vi.fn()
}))

vi.mock('../transport/mobile-relay-e2ee-link', () => ({
  MobileRelayE2eeLink: class {
    constructor(options: NonNullable<typeof fakes.options>) {
      fakes.options = options
    }
    sendText = fakes.sendText
    close = fakes.close
  }
}))

import { connectAccountRuntimeRpcSession } from './account-runtime-rpc-session'

const connection = {
  connectionIntentId: 'intent-1',
  ticketId: 'ticket-1',
  ticketSecret: 'ticket-secret',
  expiresAt: '2026-08-31T01:00:00Z',
  runtimePublicKeyB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  clientKeyPair: {
    publicKey: new Uint8Array(32).fill(1),
    secretKey: new Uint8Array(32).fill(2)
  },
  relay: {
    cellUrl: 'https://relay.example.com',
    relayHostId: 'AbCdEf0123_-xyZ9',
    assignmentEpoch: 1
  }
}

describe('account Runtime RPC session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fakes.options = null
    fakes.sendText.mockReturnValue(true)
  })

  it('uses the ticket only in memory and becomes connected after E2EE authentication', async () => {
    const session = connectAccountRuntimeRpcSession({ connection, requestTimeoutMs: 1_000 })
    expect(fakes.options).toMatchObject({
      credential: { ticketId: 'ticket-1', ticketSecret: 'ticket-secret' },
      expectedCredentialKind: 'ticket',
      deviceToken: 'ticket-secret'
    })

    fakes.options!.onHello({ credentialKind: 'ticket', leaseExpiresAt: Date.now() + 60_000 })
    expect(session.getState()).toBe('handshaking')
    fakes.options!.onAuthenticated()
    expect(session.getState()).toBe('connected')

    const result = session.sendRequest('status.get')
    await vi.waitFor(() => expect(fakes.sendText).toHaveBeenCalledOnce())
    const sent = JSON.parse(fakes.sendText.mock.calls[0]![0] as string) as { id: string }
    fakes.options!.onText(
      JSON.stringify({ id: sent.id, ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } })
    )

    await expect(result).resolves.toMatchObject({ ok: true })
    session.close()
    expect(fakes.close).toHaveBeenCalledOnce()
  })

  it('rejects connection waiters immediately on a terminal link failure', async () => {
    const session = connectAccountRuntimeRpcSession({ connection, requestTimeoutMs: 60_000 })
    const waiting = session.sendRequest('status.get')

    fakes.options!.onError(new Error('relay closed'))

    await expect(waiting).rejects.toThrow('account Runtime session disconnected')
    expect(session.getState()).toBe('disconnected')
  })

  it('ignores late authentication after failure and fails later requests immediately', async () => {
    const session = connectAccountRuntimeRpcSession({ connection, requestTimeoutMs: 60_000 })
    fakes.options!.onError(new Error('relay closed'))
    fakes.options!.onAuthenticated()

    expect(session.getState()).toBe('disconnected')
    await expect(session.sendRequest('status.get')).rejects.toThrow(
      'account Runtime session disconnected'
    )
    expect(fakes.sendText).not.toHaveBeenCalled()
  })
})
