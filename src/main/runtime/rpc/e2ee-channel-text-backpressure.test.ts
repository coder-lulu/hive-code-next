import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import { E2EEChannel, type E2EEChannelOptions } from './e2ee-channel'
import { generateKeyPair } from './e2ee-crypto'
import { RuntimeE2EEClientSession } from '../../../shared/runtime-e2ee-client-session'
import { createMobileE2EEOutboundMemoryBudget } from './mobile-e2ee-outbound-memory-budget'
import { REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES } from '../../../shared/remote-runtime-memory-limits'

const trackMock = vi.hoisted(() => vi.fn())

vi.mock('../../telemetry/client', () => ({ track: trackMock }))

// Repro for gap (a): the streaming JSON reply path (encryptedReply) had no
// bufferedAmount gate, so a fast producer over a slow link (legacy
// terminal.subscribe, which has NO seq/resync) ballooned ws.bufferedAmount
// without bound. The fix holds replies in order and drains on recovery — never
// dropping a frame (which would recreate the corruption bug on the legacy path).

function publicKeyToBase64(key: Uint8Array): string {
  return Buffer.from(key).toString('base64')
}

function createMockWs() {
  const sent: string[] = []
  return {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string) => {
      sent.push(data)
    }),
    close: vi.fn(),
    sent
  }
}

function setup(overrides?: Partial<E2EEChannelOptions>) {
  const serverKeys = generateKeyPair()
  const clientKeys = generateKeyPair()
  const ws = createMockWs()
  const onError = vi.fn()
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: serverKeys.secretKey,
    resolveAuthenticatedDevice: (token) =>
      token === 'valid-token'
        ? { deviceId: 'device-1', deviceToken: token, scope: 'mobile' }
        : null,
    onReady: vi.fn(),
    onError,
    ...overrides
  })
  const sharedKey = RuntimeE2EEClientSession.create({
    desktopPublicKeyB64: publicKeyToBase64(serverKeys.publicKey),
    transport: 'direct',
    clientKeyPair: clientKeys
  })
  channel.handleRawMessage(JSON.stringify(sharedKey.hello))
  expect(sharedKey.acceptReady(JSON.parse(ws.sent[0]))).toBe(true)
  channel.handleRawMessage(sharedKey.sealText(sharedKey.authMessage('valid-token')))
  expect(sharedKey.isAuthenticated(sharedKey.openText(ws.sent[1])!)).toBe(true)
  return { channel, ws, sharedKey, onError }
}

/** Fire a streaming reply through the real channel's encryptedReply closure. */
function emitReply(ctx: ReturnType<typeof setup>, payload: string): void {
  ctx.channel.onMessage((_plaintext, encryptedReply) => {
    encryptedReply(payload)
  })
  ctx.channel.handleRawMessage(ctx.sharedKey.sealText('{"id":"x","method":"status.get"}'))
}

describe('E2EE text reply backpressure', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    trackMock.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds text replies while over the buffer cap and drains them in order', () => {
    const ctx = setup()
    const baseline = ctx.ws.sent.length // ready + authenticated control frames

    // Simulate a congested socket: bufferedAmount pinned over the 8 MiB cap.
    ctx.ws.bufferedAmount = 9 * 1024 * 1024

    emitReply(ctx, '{"seq":1}')
    emitReply(ctx, '{"seq":2}')
    emitReply(ctx, '{"seq":3}')

    // Not dropped, not sent yet — parked in order on the queue.
    expect(ctx.ws.sent.length).toBe(baseline)

    // Link drains; the queue flushes every reply, in order, none lost.
    ctx.ws.bufferedAmount = 0
    vi.runOnlyPendingTimers()

    const replies = ctx.ws.sent.slice(baseline).map((frame) => ctx.sharedKey.openText(frame))
    expect(replies).toEqual(['{"seq":1}', '{"seq":2}', '{"seq":3}'])
    expect(ctx.onError).not.toHaveBeenCalled()
  })

  it('sends straight through when the socket is not congested', () => {
    const ctx = setup()
    const baseline = ctx.ws.sent.length
    emitReply(ctx, '{"ok":true}')
    expect(ctx.ws.sent.length).toBe(baseline + 1)
    expect(ctx.sharedKey.openText(ctx.ws.sent[baseline]!)).toBe('{"ok":true}')
  })

  it('still closes an oversized reply when telemetry throws', () => {
    const ctx = setup()
    trackMock.mockImplementationOnce(() => {
      throw new Error('telemetry unavailable')
    })

    expect(() =>
      emitReply(ctx, 'x'.repeat(REMOTE_RUNTIME_MAX_OUTBOUND_JSON_BYTES + 1))
    ).not.toThrow()
    expect(trackMock).toHaveBeenCalledWith('remote_outbound_budget_close', { emitter: 'size' })
    expect(ctx.onError).toHaveBeenCalledWith(1013, 'Outbound reply buffer overflow')
  })

  it('rejects aggregate queue growth across independently backpressured sockets', () => {
    const outboundMemoryBudget = createMobileE2EEOutboundMemoryBudget({
      maxBufferedBytes: 1_000,
      maxQueuedBytes: 150,
      maxQueuedFrames: 10
    })
    const first = setup({ outboundMemoryBudget })
    const second = setup({ outboundMemoryBudget })
    first.ws.bufferedAmount = 1_001
    second.ws.bufferedAmount = 1_001

    emitReply(first, 'x'.repeat(40))
    emitReply(second, 'x'.repeat(40))

    expect(first.onError).not.toHaveBeenCalled()
    expect(second.onError).toHaveBeenCalledWith(1013, 'Outbound reply buffer overflow')
    // Why: this close kills the whole remote session, so it has to be countable.
    expect(trackMock).toHaveBeenCalledWith('remote_outbound_budget_close', {
      emitter: 'queue'
    })
    first.channel.destroy()
    expect(outboundMemoryBudget.evidence().queuedBytes).toBe(0)
  })
})
