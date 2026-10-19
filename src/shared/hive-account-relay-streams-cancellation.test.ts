import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HiveAccountRelayStreams } from './hive-account-relay-streams'
import { HiveAccountRelayChannel } from './hive-account-relay-channel'

function setup() {
  let resolve!: (channel: HiveAccountRelayChannel) => void
  const pending = new Promise<HiveAccountRelayChannel>((done) => {
    resolve = done
  })
  const channel = new HiveAccountRelayChannel({
    material: {
      outer: {
        cellId: 'cell',
        cellIncarnationId: 'incarnation',
        assignmentId: 'assignment',
        assignmentEpoch: 1,
        cellUrl: 'https://relay.hive.test',
        clientAdmissionToken: 'token',
        relayHostId: 'host',
        expiresAt: Date.now() + 60_000
      },
      inner: {
        intentId: 'intent',
        ticketId: 'ticket',
        ticketSecret: new Uint8Array(32),
        runtimePublicKeyB64: 'key'
      },
      clientKeyPair: { publicKey: new Uint8Array(32), secretKey: new Uint8Array(32) },
      clientKind: 'WEB'
    },
    createSocket: vi.fn()
  })
  vi.spyOn(channel, 'close').mockImplementation(() => undefined)
  vi.spyOn(channel, 'subscribe').mockImplementation(() => () => undefined)
  vi.spyOn(channel, 'sendBinary').mockReturnValue(true)
  const openChannel = vi.fn(() => pending)
  const streams = new HiveAccountRelayStreams({
    openChannel,
    nextId: () => 'id',
    isClosed: () => false
  })
  return {
    streams,
    channel,
    openChannel,
    resolve: () => resolve(channel)
  }
}
const callbacks = () => ({ onResponse: vi.fn(), onError: vi.fn(), onClose: vi.fn() })
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Relay subscription consumer cancellation', () => {
  it('does not open a channel for a cancelled consumer', async () => {
    const { streams, openChannel } = setup()
    const controller = new AbortController()
    controller.abort()
    const promise = streams.subscribe('watch', {}, callbacks(), 100, controller.signal)
    const assertion = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(openChannel).not.toHaveBeenCalled()
  })

  it('cancels pending acquisition and never sends an abandoned stream, even on same-tick resolve', async () => {
    const { streams, channel, resolve } = setup()
    const controller = new AbortController()
    const listeners = callbacks()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = streams.subscribe('watch', {}, listeners, 100, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    resolve()
    controller.abort()
    await assertion
    await vi.runAllTimersAsync()
    expect(channel.subscribe).not.toHaveBeenCalled()
    expect(channel.close).toHaveBeenCalled()
    expect(listeners.onError).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('releases only the cancelled consumer of a shared pending stream', async () => {
    const { streams, channel, resolve } = setup()
    const controller = new AbortController()
    const pending = streams.subscribe('watch', {}, callbacks(), 100, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    const survivor = streams.subscribe('watch', {}, callbacks(), 100)
    controller.abort()
    resolve()
    await assertion
    const handle = await survivor
    expect(channel.subscribe).toHaveBeenCalledOnce()
    expect(channel.close).not.toHaveBeenCalled()
    expect(handle.sendBinary(new Uint8Array([1]))).toBe(true)
    handle.close()
    await Promise.resolve()
    expect(channel.close).toHaveBeenCalledOnce()
  })

  it('removes cancellation listeners on explicit close and preserves other consumers', async () => {
    const { streams, channel, resolve } = setup()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const first = streams.subscribe('watch', {}, callbacks(), 100, controller.signal)
    const second = streams.subscribe('watch', {}, callbacks(), 100)
    resolve()
    const firstHandle = await first
    const secondHandle = await second
    firstHandle.close()
    controller.abort()
    expect(channel.close).not.toHaveBeenCalled()
    expect(secondHandle.sendBinary(new Uint8Array([1]))).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    secondHandle.close()
  })

  it('releases consumer capacity after repeated cancellations', async () => {
    const { streams, resolve } = setup()
    for (let index = 0; index < 65; index++) {
      const controller = new AbortController()
      const pending = streams.subscribe('watch', {}, callbacks(), 100, controller.signal)
      const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await vi.advanceTimersByTimeAsync(100)
      await assertion
    }
    const pending = streams.subscribe('watch', {}, callbacks(), 100)
    resolve()
    const handle = await pending
    handle.close()
  })
})
