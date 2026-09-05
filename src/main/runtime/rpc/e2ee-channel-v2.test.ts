import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import nacl from 'tweetnacl'
import type { WebSocket } from 'ws'
import {
  encodeMobileE2EEV2Transcript,
  validateMobileE2EEV2Handshake,
  type MobileE2EEV2Hello,
  type MobileE2EEV2Ready
} from '../../../shared/mobile-e2ee-v2-contract'
import {
  openMobileE2EEV2Frame,
  sealMobileE2EEV2Frame
} from '../../../shared/mobile-e2ee-v2-framing'
import { deriveSharedKey } from './e2ee-crypto'
import { E2EEChannel, type E2EEChannelOptions } from './e2ee-channel'
import type {
  E2EEAuthenticatedAccountSession,
  E2EEAccountBinding
} from './e2ee-channel-account-authentication'
import { deriveMobileE2EEV2KeySchedule } from './mobile-e2ee-v2-key-schedule'

const server = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(1))
const client = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(2))

function createMockWs() {
  const sent: { data: string | Buffer; options?: { binary?: boolean } }[] = []
  return {
    OPEN: 1 as const,
    readyState: 1,
    bufferedAmount: 0,
    send: vi.fn((data: string | Buffer, options?: { binary?: boolean }) => {
      sent.push({ data, options })
    }),
    sent
  }
}

function hello(): MobileE2EEV2Hello {
  return {
    type: 'e2ee_hello',
    v: 2,
    clientPublicKeyB64: Buffer.from(client.publicKey).toString('base64'),
    clientNonceB64: Buffer.from(new Uint8Array(32).fill(3)).toString('base64'),
    capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
    context: {
      protocol: 'orca-mobile-e2ee',
      initiator: 'mobile',
      responder: 'desktop',
      transport: 'relay',
      relayHostId: 'AbCdEf0123_-xyZ9'
    }
  }
}

function setup(accountOptions: Partial<E2EEChannelOptions> = {}) {
  const ws = createMockWs()
  const onReady = vi.fn()
  const onError = vi.fn()
  const resolveAuthenticatedDevice = vi.fn((token: string) =>
    token === 'valid-token'
      ? { deviceId: 'device-1', deviceToken: token, scope: 'mobile' as const }
      : null
  )
  const channel = new E2EEChannel(ws as unknown as WebSocket, {
    serverSecretKey: server.secretKey,
    resolveAuthenticatedDevice,
    onReady,
    onError,
    transportContext: { transport: 'relay', relayHostId: 'AbCdEf0123_-xyZ9' },
    requireV2: true,
    ...accountOptions
  })
  return { ws, channel, onReady, onError, resolveAuthenticatedDevice }
}

function startV2(ctx: ReturnType<typeof setup>) {
  const clientHello = hello()
  ctx.channel.handleRawMessage(JSON.stringify(clientHello))
  const ready = JSON.parse(ctx.ws.sent[0]!.data.toString()) as MobileE2EEV2Ready
  const handshake = validateMobileE2EEV2Handshake(clientHello, ready)!
  const schedule = deriveMobileE2EEV2KeySchedule({
    sharedSecret: deriveSharedKey(client.secretKey, server.publicKey),
    transcript: encodeMobileE2EEV2Transcript(handshake),
    clientNonce: handshake.clientNonce,
    desktopNonce: handshake.desktopNonce
  })
  return { ready, schedule }
}

function clientText(
  plaintext: string,
  schedule: ReturnType<typeof startV2>['schedule'],
  counter: bigint
): string {
  const frame = sealMobileE2EEV2Frame({
    payload: new TextEncoder().encode(plaintext),
    key: schedule.mobileToDesktopKey,
    sessionId: schedule.sessionId,
    direction: 'mobile-to-desktop',
    payloadKind: 'text',
    counter
  })
  return Buffer.from(frame).toString('base64')
}

function openServerFrame(
  frame: string | Buffer,
  kind: 'text' | 'binary',
  schedule: ReturnType<typeof startV2>['schedule'],
  counter: bigint
): Uint8Array | null {
  return openMobileE2EEV2Frame({
    frame: typeof frame === 'string' ? Buffer.from(frame, 'base64') : frame,
    key: schedule.desktopToMobileKey,
    sessionId: schedule.sessionId,
    direction: 'desktop-to-mobile',
    payloadKind: kind,
    expectedCounter: counter
  })
}

function authenticate(
  ctx: ReturnType<typeof setup>,
  schedule: ReturnType<typeof startV2>['schedule']
) {
  const transcriptHashB64 = Buffer.from(schedule.transcriptHash).toString('base64')
  ctx.channel.handleRawMessage(
    clientText(
      JSON.stringify({
        type: 'e2ee_auth',
        v: 2,
        transcriptHashB64,
        deviceToken: 'valid-token'
      }),
      schedule,
      0n
    )
  )
}

describe('E2EEChannel v2', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('confirms the transcript before evaluating DeviceRegistry auth', () => {
    const ctx = setup()
    const { schedule } = startV2(ctx)
    authenticate(ctx, schedule)

    expect(ctx.resolveAuthenticatedDevice).toHaveBeenCalledOnce()
    expect(ctx.onReady).toHaveBeenCalledWith(ctx.channel, {
      deviceId: 'device-1',
      deviceToken: 'valid-token',
      scope: 'mobile'
    })
    const authenticated = openServerFrame(ctx.ws.sent[1]!.data, 'text', schedule, 0n)
    expect(JSON.parse(new TextDecoder().decode(authenticated!))).toEqual({
      type: 'e2ee_authenticated',
      v: 2,
      transcriptHashB64: Buffer.from(schedule.transcriptHash).toString('base64')
    })
  })

  it('forwards post-auth capability-shaped frames without mutating authenticated capabilities', () => {
    const ctx = setup()
    const { schedule } = startV2(ctx)
    const onMessage = vi.fn()
    ctx.channel.onMessage(onMessage)
    authenticate(ctx, schedule)

    const capabilityFrame = JSON.stringify({
      type: 'e2ee_client_capabilities',
      v: 1,
      clientCapabilities: ['agent-session.structured.v1']
    })
    ctx.channel.handleRawMessage(clientText(capabilityFrame, schedule, 1n))

    expect(ctx.channel.clientCapabilities).toEqual([])
    expect(onMessage).toHaveBeenCalledOnce()
    expect(onMessage.mock.calls[0]?.[0]).toBe(capabilityFrame)
  })

  it('rejects legacy downgrade and runtime-only capability metadata when mobile v2 is required', () => {
    const legacy = setup()
    legacy.channel.handleRawMessage(
      JSON.stringify({ type: 'e2ee_hello', publicKeyB64: 'legacy-key' })
    )
    expect(legacy.onError).toHaveBeenCalledWith(4001, 'E2EE v2 required')

    const ctx = setup()
    const { schedule } = startV2(ctx)
    const transcriptHashB64 = Buffer.from(schedule.transcriptHash).toString('base64')
    ctx.channel.handleRawMessage(
      clientText(
        JSON.stringify({
          type: 'e2ee_auth',
          v: 2,
          transcriptHashB64,
          deviceToken: 'valid-token',
          clientCapabilities: ['session-tabs.close-intent.v1']
        }),
        schedule,
        0n
      )
    )
    expect(ctx.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    expect(ctx.onError).toHaveBeenCalledWith(4001, 'Invalid e2ee_auth')
  })

  it('rejects a captured auth frame replayed onto a fresh desktop nonce', () => {
    const first = setup()
    const firstHandshake = startV2(first)
    const capturedAuth = clientText(
      JSON.stringify({
        type: 'e2ee_auth',
        v: 2,
        transcriptHashB64: Buffer.from(firstHandshake.schedule.transcriptHash).toString('base64'),
        deviceToken: 'valid-token'
      }),
      firstHandshake.schedule,
      0n
    )

    const second = setup()
    const secondHandshake = startV2(second)
    expect(secondHandshake.ready.desktopNonceB64).not.toBe(firstHandshake.ready.desktopNonceB64)
    second.channel.handleRawMessage(capturedAuth)
    expect(second.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    expect(second.onReady).not.toHaveBeenCalled()
  })

  it('rejects a captured authenticated mutating trace on a fresh socket', () => {
    const first = setup()
    const firstHandshake = startV2(first)
    const transcriptHashB64 = Buffer.from(firstHandshake.schedule.transcriptHash).toString('base64')
    const capturedAuth = clientText(
      JSON.stringify({ type: 'e2ee_auth', v: 2, transcriptHashB64, deviceToken: 'valid-token' }),
      firstHandshake.schedule,
      0n
    )
    const capturedMutation = clientText(
      JSON.stringify({ method: 'device.remove', params: { deviceId: 'device-1' } }),
      firstHandshake.schedule,
      1n
    )
    const firstMutation = vi.fn()
    first.channel.onMessage(firstMutation)
    first.channel.handleRawMessage(capturedAuth)
    first.channel.handleRawMessage(capturedMutation)
    expect(firstMutation).toHaveBeenCalledOnce()

    const second = setup()
    startV2(second)
    const replayedMutation = vi.fn()
    second.channel.onMessage(replayedMutation)
    second.channel.handleRawMessage(capturedAuth)
    second.channel.handleRawMessage(capturedMutation)
    expect(second.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    expect(replayedMutation).not.toHaveBeenCalled()
  })

  it('preserves one queued counter order across text and binary replies', () => {
    const ctx = setup()
    const { schedule } = startV2(ctx)
    authenticate(ctx, schedule)
    ctx.ws.bufferedAmount = 9 * 1024 * 1024
    ctx.channel.onMessage((_request, textReply, binaryReply) => {
      textReply('one')
      binaryReply(new Uint8Array([2]))
    })
    ctx.channel.handleRawMessage(clientText('{"method":"status.get"}', schedule, 1n))
    expect(ctx.ws.sent).toHaveLength(2)

    ctx.ws.bufferedAmount = 0
    vi.runOnlyPendingTimers()
    expect(
      new TextDecoder().decode(openServerFrame(ctx.ws.sent[2]!.data, 'text', schedule, 1n)!)
    ).toBe('one')
    expect(openServerFrame(ctx.ws.sent[3]!.data, 'binary', schedule, 2n)).toEqual(
      new Uint8Array([2])
    )
    expect(ctx.ws.sent[3]!.options).toEqual({ binary: true })
  })
})

describe('Account asynchronous authentication boundary', () => {
  const auth = {
    type: 'e2ee_auth',
    principalKind: 'account_runtime_session',
    ticketId: '11111111-1111-4111-8111-111111111111',
    ticketSecret: 'A'.repeat(43)
  }
  function pending() {
    let resolve!: (principal: E2EEAuthenticatedAccountSession | null) => void
    const resolver = vi.fn(
      (_auth: unknown, _signal: AbortSignal, _binding: E2EEAccountBinding) =>
        new Promise<E2EEAuthenticatedAccountSession | null>((done) => {
          resolve = done
        })
    )
    const ready = vi.fn()
    const ctx = setup({ resolveAccountSession: resolver, onAccountReady: ready })
    const { schedule } = startV2(ctx)
    const message = vi.fn()
    ctx.channel.onMessage(message)
    ctx.channel.handleRawMessage(clientText(JSON.stringify(auth), schedule, 0n))
    return { ...ctx, resolver, ready, resolve, schedule, message }
  }
  const principal = (): E2EEAuthenticatedAccountSession => ({
    principalKind: 'account_runtime_session',
    runtimeSessionId: 'session',
    expiresAt: Date.now() + 60000
  })
  it('opens RPC only after the resolver adjudicates activation and never authenticates a device', async () => {
    const ctx = pending()
    expect(ctx.ws.sent).toHaveLength(1)
    expect(ctx.resolver.mock.calls[0]![2]).toEqual({
      clientPublicKeyB64: Buffer.from(client.publicKey).toString('base64'),
      transcriptHashB64: Buffer.from(ctx.schedule.transcriptHash).toString('base64')
    })
    expect(ctx.ready).not.toHaveBeenCalled()
    ctx.resolve(principal())
    await Promise.resolve()
    expect(ctx.ready).toHaveBeenCalledOnce()
    expect(ctx.onReady).not.toHaveBeenCalled()
    expect(ctx.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    ctx.channel.handleRawMessage(clientText('{"method":"status.get"}', ctx.schedule, 1n))
    expect(ctx.message).toHaveBeenCalledOnce()
    ctx.channel.destroy()
  })
  it.each(['reentry', 'close', 'deadline'] as const)(
    'aborts %s and ignores late consume completion',
    async (cause) => {
      vi.useFakeTimers()
      const ctx = pending()
      if (cause === 'reentry') {
        ctx.channel.handleRawMessage(clientText(JSON.stringify(auth), ctx.schedule, 1n))
      }
      if (cause === 'close') {
        ctx.channel.destroy()
      }
      if (cause === 'deadline') {
        vi.advanceTimersByTime(10000)
      }
      expect(ctx.resolver.mock.calls[0]![1].aborted).toBe(true)
      ctx.resolve(principal())
      await Promise.resolve()
      expect(ctx.resolver).toHaveBeenCalledOnce()
      expect(ctx.ready).not.toHaveBeenCalled()
      expect(ctx.message).not.toHaveBeenCalled()
      ctx.channel.destroy()
      vi.useRealTimers()
    }
  )
  it('refuses extra authentication credentials before invoking a resolver', () => {
    const resolver = vi.fn()
    const ctx = setup({ resolveAccountSession: resolver, onAccountReady: vi.fn() })
    const { schedule } = startV2(ctx)
    ctx.channel.handleRawMessage(
      clientText(JSON.stringify({ ...auth, deviceToken: 'forbidden' }), schedule, 0n)
    )
    expect(resolver).not.toHaveBeenCalled()
    expect(ctx.resolveAuthenticatedDevice).not.toHaveBeenCalled()
    expect(ctx.onError).toHaveBeenCalledWith(4001, 'Unauthorized', 'account_runtime_session')
    ctx.channel.destroy()
  })
})
