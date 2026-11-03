import { describe, expect, it, vi } from 'vitest'
import type { HiveAccountRelayMaterial } from '../../../../shared/hive-account-relay-material'
import type { HiveAccountRelaySubscription } from '../../../../shared/hive-account-relay-channel'

const state = vi.hoisted(() => ({
  request: vi.fn(),
  subscribe: vi.fn(),
  afterConnect: null as (() => void | Promise<void>) | null,
  channels: [] as {
    isClosed: boolean
    requests: unknown[][]
    callbacks: HiveAccountRelaySubscription | null
    close: (error?: Error) => void
  }[]
}))
vi.mock('../../../../shared/hive-account-relay-channel', () => ({
  HiveAccountRelayChannel: class {
    isClosed = false
    requests: unknown[][] = []
    get isReady() {
      return !this.isClosed
    }
    callbacks: HiveAccountRelaySubscription | null = null
    constructor(private options: { onClosed: (error: Error, intentional: boolean) => void }) {
      state.channels.push(this)
    }
    async connect() {
      await state.afterConnect?.()
    }
    async request(...args: unknown[]) {
      this.requests.push(args)
      state.request(...args)
      return { id: 'reply', ok: true, result: 'ok', _meta: { runtimeId: 'runtime' } }
    }
    subscribe(request: unknown, callbacks: HiveAccountRelaySubscription) {
      state.subscribe(request)
      this.callbacks = callbacks
    }
    sendBinary() {
      return !this.isClosed
    }
    close(error?: Error) {
      if (this.isClosed) {
        return
      }
      this.isClosed = true
      this.options.onClosed(error ?? new Error('disposed'), !error)
      this.callbacks?.onClose?.()
    }
  }
}))
import { createWebAccountRelayClient } from './web-account-relay-client'

function material(): HiveAccountRelayMaterial {
  return {
    outer: {
      cellId: 'cell',
      cellIncarnationId: 'incarnation',
      assignmentId: 'assignment',
      assignmentEpoch: 1,
      cellUrl: 'https://relay.hive.test',
      clientAdmissionToken: 'cat',
      relayHostId: 'host',
      expiresAt: Date.now() + 60_000
    },
    inner: {
      intentId: 'intent',
      ticketId: 'ticket',
      ticketSecret: new Uint8Array(32).fill(1),
      runtimePublicKeyB64: 'key'
    },
    clientKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32).fill(2) },
    clientKind: 'WEB'
  }
}

describe('account Relay receipt epochs', () => {
  it('pins facade writes to a verified stream while ordinary requests keep the main channel', async () => {
    const client = createWebAccountRelayClient(async () => material(), vi.fn())
    try {
      await client.subscribe('watch', {}, { onResponse: vi.fn() })
      await client.call('status.get')
      const epoch = client.connectionEpoch
      expect(epoch).toBeGreaterThan(0)
      await client.call('files.write', { path: 'file' }, { expectedConnectionEpoch: epoch })
      expect(state.channels).toHaveLength(1)
      expect(state.channels[0]!.requests.map(([request]) => request)).toEqual([
        expect.objectContaining({ method: 'status.get' }),
        expect.objectContaining({ method: 'files.write' })
      ])
      await client.call('files.read', { path: 'file' })
      expect(state.channels).toHaveLength(2)
      expect(state.channels[1]!.requests).toEqual([
        [expect.objectContaining({ method: 'files.read' }), expect.any(Number), undefined]
      ])
      await client.call('status.get')
      expect(client.connectionEpoch).toBe(epoch)
      expect(state.channels[0]!.requests.at(-1)?.[0]).toMatchObject({ method: 'status.get' })
    } finally {
      client.close()
    }
  })
})
