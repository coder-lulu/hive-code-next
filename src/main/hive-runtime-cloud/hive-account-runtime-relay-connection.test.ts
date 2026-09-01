import { EventEmitter } from 'node:events'
import WebSocket from 'ws'
import { describe, expect, it, vi } from 'vitest'
import type { MobileE2EEV2Hello } from '../../shared/mobile-e2ee-v2-contract'
import { generateKeyPair, publicKeyToBase64 } from '../../shared/e2ee-crypto'
import { DesktopMobileE2EEV2Session } from '../runtime/rpc/mobile-e2ee-v2-desktop-session'
import { HiveAccountRuntimeRelayConnection } from './hive-account-runtime-relay-connection'
import { hasNonZeroX25519SharedSecret } from './hive-account-runtime-relay-e2ee'
import {
  parseRelayTicketHello,
  parseRuntimeResponse,
  relaySocketUrl
} from './hive-account-runtime-relay-protocol'

describe('Hive account Runtime relay connection boundary', () => {
  it('builds the fixed relay consumer path without carrying cell query state', () => {
    expect(
      relaySocketUrl({
        cellUrl: 'https://relay.hivekernel.com?untrusted=1#fragment',
        relayHostId: 'abcdefghijklmnop'
      })
    ).toBe('wss://relay.hivekernel.com/v1/connect/abcdefghijklmnop')
  })

  it('accepts only an unexpired ticket lease hello with no extra fields', () => {
    expect(
      parseRelayTicketHello(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'ticket',
          leaseExpiresAt: 2_000
        }),
        1_000
      )
    ).toEqual({ credentialKind: 'ticket', leaseExpiresAt: 2_000 })
    expect(
      parseRelayTicketHello(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'ticket',
          leaseExpiresAt: 2_000,
          ownerAccountId: 'must-not-leak'
        }),
        1_000
      )
    ).toBeNull()
    expect(
      parseRelayTicketHello(
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'ticket',
          leaseExpiresAt: 1_000
        }),
        1_000
      )
    ).toBeNull()
  })

  it('ignores keepalives and validates Runtime response envelopes', () => {
    expect(parseRuntimeResponse('{"_keepalive":true}')).toBeNull()
    expect(
      parseRuntimeResponse(
        JSON.stringify({
          id: 'request-1',
          ok: true,
          result: null,
          _meta: { runtimeId: 'runtime-1' }
        })
      )
    ).toMatchObject({ id: 'request-1', ok: true })
    expect(() =>
      parseRuntimeResponse(
        JSON.stringify({ id: 'request-1', ok: false, error: { message: 'missing code' } })
      )
    ).toThrow('invalid response frame')
  })

  it('rejects low-order Runtime X25519 public keys before key derivation', () => {
    const client = generateKeyPair()

    expect(hasNonZeroX25519SharedSecret(client.secretKey, new Uint8Array(32))).toBe(false)
    expect(hasNonZeroX25519SharedSecret(client.secretKey, generateKeyPair().publicKey)).toBe(true)
  })

  it('refuses a relay socket when the process-wide outbound budget is exhausted', () => {
    const terminate = vi.fn()
    const socket = Object.assign(new EventEmitter(), {
      readyState: WebSocket.CONNECTING,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      terminate
    })

    expect(
      () =>
        new HiveAccountRuntimeRelayConnection(
          {
            connectionIntentId: 'intent-1',
            ticketId: 'ticket-1',
            ticketSecret: 'ticket-secret',
            runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
            expiresAt: 10_000,
            runtimePublicKeyB64: 'A'.repeat(44),
            clientKeyPair: generateKeyPair(),
            relay: {
              cellUrl: 'https://relay.hivekernel.com',
              relayHostId: 'abcdefghijklmnop',
              assignmentEpoch: 1,
              e2eeFraming: 'hive-e2ee-v1'
            }
          },
          {
            createSocket: () => socket as never,
            now: () => 1_000,
            outboundMemoryBudget: {
              claimQueuedBytes: () => null,
              registerBufferedAmount: () => null,
              evidence: () => ({
                bufferedBytes: 0,
                queuedBytes: 0,
                queuedFrames: 0,
                sockets: 0
              })
            }
          }
        )
    ).toThrow('outbound memory admission failed')
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('settles an in-flight connect when the owner closes during handshake', async () => {
    const socket = Object.assign(new EventEmitter(), {
      readyState: WebSocket.CONNECTING,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      terminate: vi.fn()
    })
    const connection = new HiveAccountRuntimeRelayConnection(
      {
        connectionIntentId: 'intent-1',
        ticketId: 'ticket-1',
        ticketSecret: 'ticket-secret',
        runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
        expiresAt: 10_000,
        runtimePublicKeyB64: 'A'.repeat(44),
        clientKeyPair: generateKeyPair(),
        relay: {
          cellUrl: 'https://relay.hivekernel.com',
          relayHostId: 'abcdefghijklmnop',
          assignmentEpoch: 1,
          e2eeFraming: 'hive-e2ee-v1'
        }
      },
      { createSocket: () => socket as never, now: () => 1_000 }
    )

    const connecting = connection.connect(30_000)
    connection.close()

    await expect(connecting).rejects.toMatchObject({ code: 'remote_runtime_unavailable' })
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('keeps an authenticated socket open after the ticket attach deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    try {
      const runtimeKeyPair = generateKeyPair()
      const socket = Object.assign(new EventEmitter(), {
        readyState: WebSocket.CONNECTING as number,
        bufferedAmount: 0,
        send: vi.fn(),
        close: vi.fn(),
        terminate: vi.fn()
      })
      const connection = new HiveAccountRuntimeRelayConnection(
        {
          connectionIntentId: 'intent-1',
          ticketId: 'ticket-1',
          ticketSecret: 'ticket-secret',
          runtimeRecordId: '123e4567-e89b-42d3-a456-426614174000',
          expiresAt: 1_200,
          runtimePublicKeyB64: publicKeyToBase64(runtimeKeyPair.publicKey),
          clientKeyPair: generateKeyPair(),
          relay: {
            cellUrl: 'https://relay.hivekernel.com',
            relayHostId: 'abcdefghijklmnop',
            assignmentEpoch: 1,
            e2eeFraming: 'hive-e2ee-v1'
          }
        },
        { createSocket: () => socket as never, now: Date.now }
      )
      const connecting = connection.connect(5_000)
      socket.readyState = WebSocket.OPEN
      socket.emit('open')
      socket.emit(
        'message',
        JSON.stringify({
          type: 'relay-hello',
          ok: true,
          credentialKind: 'ticket',
          leaseExpiresAt: 1_100
        }),
        false
      )
      const hello = JSON.parse(String(socket.send.mock.calls[1]?.[0])) as MobileE2EEV2Hello
      const runtimeSession = DesktopMobileE2EEV2Session.create({
        hello,
        serverSecretKey: runtimeKeyPair.secretKey,
        expectedContext: { transport: 'relay', relayHostId: 'abcdefghijklmnop' }
      })!
      socket.emit('message', JSON.stringify(runtimeSession.ready), false)
      expect(runtimeSession.openText(String(socket.send.mock.calls[2]?.[0]))).toContain('e2ee_auth')
      socket.emit(
        'message',
        runtimeSession.sealText(
          JSON.stringify({
            type: 'e2ee_authenticated',
            v: 2,
            transcriptHashB64: runtimeSession.transcriptHashB64
          })
        ),
        false
      )
      await connecting

      await vi.advanceTimersByTimeAsync(500)

      expect(socket.terminate).not.toHaveBeenCalled()
      connection.close()
      socket.emit('close')
    } finally {
      vi.useRealTimers()
    }
  })
})
