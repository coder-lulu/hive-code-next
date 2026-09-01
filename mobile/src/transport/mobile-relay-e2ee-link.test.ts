import { describe, expect, it, vi } from 'vitest'

const channelFakes = vi.hoisted(() => ({
  start: vi.fn(),
  handleMessage: vi.fn(async () => {}),
  sendText: vi.fn(() => true),
  sendBinary: vi.fn(() => true),
  dispose: vi.fn()
}))

vi.mock('./mobile-e2ee-v2-client-session', () => ({
  MobileE2EEV2ClientSession: {
    create: () => ({})
  }
}))

vi.mock('./mobile-e2ee-v2-physical-channel', () => ({
  MobileE2EEV2PhysicalChannel: class {
    start = channelFakes.start
    handleMessage = channelFakes.handleMessage
    sendText = channelFakes.sendText
    sendBinary = channelFakes.sendBinary
    dispose = channelFakes.dispose
  }
}))

import { MobileRelayE2eeLink } from './mobile-relay-e2ee-link'

class ThrowingSocket {
  static readonly OPEN = 1
  readonly OPEN = ThrowingSocket.OPEN
  readyState = ThrowingSocket.OPEN
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number }) => void) | null = null
  send = vi.fn(() => {
    throw new Error('relay auth write failed')
  })
  close = vi.fn()
}

class RecordingSocket extends ThrowingSocket {
  send = vi.fn()
}

describe('MobileRelayE2eeLink', () => {
  it('does not write a credential when a stale open event arrives after close', () => {
    const socket = new RecordingSocket()
    const link = new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
      expectedCredentialKind: 'ticket',
      deviceToken: 'secret-1',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onError: vi.fn(),
      createSocket: () => socket as unknown as WebSocket
    })

    link.close()
    socket.onopen?.()
    socket.onerror?.()

    expect(socket.send).not.toHaveBeenCalled()
  })

  it('does not start the E2EE channel when onHello closes the link', async () => {
    channelFakes.start.mockClear()
    channelFakes.dispose.mockClear()
    const socket = new RecordingSocket()
    let link!: MobileRelayE2eeLink
    link = new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
      expectedCredentialKind: 'ticket',
      deviceToken: 'secret-1',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onHello: () => link.close(),
      onError: vi.fn(),
      createSocket: () => socket as unknown as WebSocket
    })

    socket.onmessage?.({
      data: JSON.stringify({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'ticket',
        leaseExpiresAt: Date.now() + 60_000
      })
    })
    await vi.waitFor(() => expect(channelFakes.dispose).toHaveBeenCalledOnce())

    expect(channelFakes.start).not.toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('accepts a one-time account ticket hello without treating it as a pairing credential', async () => {
    const socket = new RecordingSocket()
    const onHello = vi.fn()
    new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
      expectedCredentialKind: 'ticket',
      deviceToken: 'secret-1',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onHello,
      onError: vi.fn(),
      createSocket: () => socket as unknown as WebSocket
    })

    socket.onopen?.()
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'relay-hello',
        ok: true,
        credentialKind: 'ticket',
        leaseExpiresAt: Date.now() + 60_000
      })
    })
    await vi.waitFor(() => expect(onHello).toHaveBeenCalledOnce())

    expect(JSON.parse(socket.send.mock.calls[0]![0] as string)).toEqual({
      type: 'relay-auth',
      v: 1,
      mode: 'connect',
      credential: { ticketId: 'ticket-1', ticketSecret: 'secret-1' }
    })
  })

  it('routes the initial relay-auth write exception through link failure', () => {
    const socket = new ThrowingSocket()
    const onError = vi.fn()
    new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: 'credential',
      expectedCredentialKind: 'resume',
      deviceToken: 'device-token',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onError,
      createSocket: () => socket as unknown as WebSocket
    })

    expect(() => socket.onopen?.()).not.toThrow()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'relay auth write failed' })
    )
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('keeps a typed close code when transport error precedes close', () => {
    const socket = new ThrowingSocket()
    const onError = vi.fn()
    new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: 'credential',
      expectedCredentialKind: 'resume',
      deviceToken: 'device-token',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onError,
      createSocket: () => socket as unknown as WebSocket
    })

    socket.onerror?.()
    socket.onclose?.({ code: 4409 })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'relay_outer_4409' }))
  })

  it('classifies an opaque close after transport error as 1006', () => {
    const socket = new ThrowingSocket()
    const onError = vi.fn()
    new MobileRelayE2eeLink({
      endpoint: {
        cellUrl: 'https://relay-c1.onorca.dev',
        relayHostId: 'AbCdEf0123_-xyZ9'
      },
      credential: 'credential',
      expectedCredentialKind: 'resume',
      deviceToken: 'device-token',
      desktopPublicKeyB64: 'desktop-key',
      onAuthenticated: vi.fn(),
      onText: vi.fn(),
      onBinary: vi.fn(),
      onError,
      createSocket: () => socket as unknown as WebSocket
    })

    socket.onerror?.()
    socket.onclose?.({ code: 0 })

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'relay_outer_1006' }))
  })

  it('bounds an error when the platform never emits close', async () => {
    vi.useFakeTimers()
    try {
      const socket = new ThrowingSocket()
      const onError = vi.fn()
      const link = new MobileRelayE2eeLink({
        endpoint: {
          cellUrl: 'https://relay-c1.onorca.dev',
          relayHostId: 'AbCdEf0123_-xyZ9'
        },
        credential: 'credential',
        expectedCredentialKind: 'resume',
        deviceToken: 'device-token',
        desktopPublicKeyB64: 'desktop-key',
        onAuthenticated: vi.fn(),
        onText: vi.fn(),
        onBinary: vi.fn(),
        onError,
        createSocket: () => socket as unknown as WebSocket
      })
      socket.onerror?.()
      await vi.advanceTimersByTimeAsync(250)

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'relay_outer_1006' }))
      link.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the missing-close timer when explicitly closed', async () => {
    vi.useFakeTimers()
    try {
      const socket = new ThrowingSocket()
      const onError = vi.fn()
      const link = new MobileRelayE2eeLink({
        endpoint: {
          cellUrl: 'https://relay-c1.onorca.dev',
          relayHostId: 'AbCdEf0123_-xyZ9'
        },
        credential: 'credential',
        expectedCredentialKind: 'resume',
        deviceToken: 'device-token',
        desktopPublicKeyB64: 'desktop-key',
        onAuthenticated: vi.fn(),
        onText: vi.fn(),
        onBinary: vi.fn(),
        onError,
        createSocket: () => socket as unknown as WebSocket
      })
      socket.onerror?.()
      link.close()
      await vi.advanceTimersByTimeAsync(250)

      expect(onError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
