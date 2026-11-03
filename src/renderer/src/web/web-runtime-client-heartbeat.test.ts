import { createPairedE2EEClientHandshake } from '../../../shared/paired-e2ee-client-handshake'
import { DesktopMobileE2EEV2Session } from '../../../shared/runtime-e2ee-server-session'
import { WEB_PAIRED_E2EE_PRIMITIVES } from './web-paired-e2ee-primitives'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { WebRuntimeConnectionTransport } from './web-runtime-connection-transport'

// Half-open WebSockets can stay OPEN without close/error; detect silence while visible and disarm timers while hidden.

const fakeSockets: FakeWebSocket[] = []
const clients: WebRuntimeConnectionTransport[] = []
let visibilityState: DocumentVisibilityState = 'visible'
let nextIntervalId = 1
const documentListeners = new Map<string, () => void>()
const intervalCallbacks = new Map<number, () => void>()
const setIntervalMock = vi.fn((callback: () => void, _intervalMs: number): number => {
  const intervalId = nextIntervalId++
  intervalCallbacks.set(intervalId, callback)
  return intervalId
})
const clearIntervalMock = vi.fn((intervalId: number): void => {
  intervalCallbacks.delete(intervalId)
})
const addDocumentEventListenerMock = vi.fn((event: string, listener: () => void): void => {
  documentListeners.set(event, listener)
})
const removeDocumentEventListenerMock = vi.fn((event: string, listener: () => void): void => {
  if (documentListeners.get(event) === listener) {
    documentListeners.delete(event)
  }
})

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  readyState = FakeWebSocket.CONNECTING
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED
  })
  send = vi.fn()
  constructor(readonly _url: string) {
    fakeSockets.push(this)
  }
}

type HeartbeatInternals = WebRuntimeConnectionTransport

function makeConnectedClient() {
  let nowMs = 1_000
  const keys = WEB_PAIRED_E2EE_PRIMITIVES.generateKeyPair()
  const hostPublicKeyB64 = WEB_PAIRED_E2EE_PRIMITIVES.publicKeyToBase64(keys.publicKey)
  const client = new WebRuntimeConnectionTransport(
    {
      endpoint: 'ws://127.0.0.1:6768',
      hostPublicKeyB64,
      credential: { kind: 'token', deviceToken: 'token' }
    },
    { now: () => nowMs, isDocumentVisible: () => visibilityState === 'visible' }
  )
  clients.push(client)
  const internals = client
  const socket = fakeSockets[0]!
  socket.readyState = FakeWebSocket.OPEN
  const handshake = createPairedE2EEClientHandshake({
    primitives: WEB_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64,
    framing: 'v2',
    transport: 'direct'
  })
  const server = DesktopMobileE2EEV2Session.create({
    hello: JSON.parse(handshake.helloText()),
    serverSecretKey: keys.secretKey,
    expectedContext: { transport: 'direct' }
  })
  if (!server || handshake.acceptReadyText(JSON.stringify(server.ready)) !== 'accepted') {
    throw new Error('Heartbeat fixture handshake failed')
  }
  internals.handshake = handshake
  internals.state = 'connected'
  internals.heartbeat.lastInboundFrameAt = nowMs
  internals.heartbeat.lastHeartbeatTickAt = nowMs
  return {
    client,
    internals,
    socket,
    setNow: (ms: number) => {
      nowMs = ms
    },
    setVisible: (visible: boolean) => {
      visibilityState = visible ? 'visible' : 'hidden'
    }
  }
}

describe('WebRuntimeClient liveness heartbeat', () => {
  beforeEach(() => {
    fakeSockets.length = 0
    visibilityState = 'visible'
    nextIntervalId = 1
    documentListeners.clear()
    intervalCallbacks.clear()
    setIntervalMock.mockClear()
    clearIntervalMock.mockClear()
    addDocumentEventListenerMock.mockClear()
    removeDocumentEventListenerMock.mockClear()
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      btoa: (value: string) => Buffer.from(value, 'binary').toString('base64')
    })
    vi.stubGlobal('document', {
      get visibilityState() {
        return visibilityState
      },
      addEventListener: addDocumentEventListenerMock,
      removeEventListener: removeDocumentEventListenerMock
    })
    vi.stubGlobal('setInterval', setIntervalMock)
    vi.stubGlobal('clearInterval', clearIntervalMock)
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    clients.splice(0).forEach((client) => client.close())
    vi.unstubAllGlobals()
  })

  function dispatchVisibilityChange(): void {
    documentListeners.get('visibilitychange')?.()
  }

  function runActiveHeartbeatTick(): void {
    expect(intervalCallbacks.size).toBe(1)
    intervalCallbacks.values().next().value?.()
  }

  // Advance tick boundaries with time so sinceLastTick models normal cadence, not suspension.
  function advanceOneTick(internals: HeartbeatInternals, setNow: (ms: number) => void): void {
    const next = internals.heartbeat.lastHeartbeatTickAt + 10_000
    setNow(next)
  }

  it('disarms the heartbeat interval while hidden', () => {
    const { client, internals, setVisible } = makeConnectedClient()

    internals.heartbeat.start()
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 10_000)
    expect(intervalCallbacks.size).toBe(1)

    setVisible(false)
    dispatchVisibilityChange()

    expect(clearIntervalMock).toHaveBeenCalledTimes(1)
    expect(intervalCallbacks.size).toBe(0)
    client.close()
  })

  it('re-arms once and resets the tick clock but preserves the liveness baseline when visible again', () => {
    const { client, internals, setNow, setVisible } = makeConnectedClient()
    internals.heartbeat.start()
    internals.heartbeat.heartbeatProbeSentAt = 1_000

    setVisible(false)
    dispatchVisibilityChange()
    setNow(601_000)
    setVisible(true)
    dispatchVisibilityChange()
    dispatchVisibilityChange()

    expect(setIntervalMock).toHaveBeenCalledTimes(2)
    expect(intervalCallbacks.size).toBe(1)
    // Visible re-arm preserves inbound baseline so hidden silence remains detectable on the next tick.
    expect(internals.heartbeat.lastInboundFrameAt).toBe(1_000)
    // The tick clock resets so the parked hidden gap isn't misread as a suspended loop; the probe clears.
    expect(internals.heartbeat.lastHeartbeatTickAt).toBe(601_000)
    expect(internals.heartbeat.heartbeatProbeSentAt).toBeNull()
    client.close()
  })

  it('probes and then closes a connection that went silent while hidden, once visible again', () => {
    const { client, internals, socket, setNow, setVisible } = makeConnectedClient()
    internals.heartbeat.start()

    // Model ten silent hidden minutes; preserved inbound baseline must prompt liveness detection on return.
    setVisible(false)
    dispatchVisibilityChange()
    setNow(601_000)
    setVisible(true)
    dispatchVisibilityChange()

    // First visible tick: idle far exceeds the threshold, so send a liveness probe (not an immediate close).
    setNow(611_000)
    runActiveHeartbeatTick()
    expect(socket.close).not.toHaveBeenCalled()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(internals.heartbeat.heartbeatProbeSentAt).toBe(611_000)

    // Normal-cadence ticks: still within grace → no close yet.
    setNow(621_000)
    runActiveHeartbeatTick()
    expect(socket.close).not.toHaveBeenCalled()

    // Probe now unanswered past grace (20s) → force the reconnect.
    setNow(631_000)
    runActiveHeartbeatTick()
    expect(socket.close).toHaveBeenCalledTimes(1)
    client.close()
  })

  it('keeps the visible heartbeat cadence unchanged', () => {
    const { client, internals, socket, setNow } = makeConnectedClient()
    internals.heartbeat.start()

    setNow(11_000)
    runActiveHeartbeatTick()
    setNow(21_000)
    runActiveHeartbeatTick()
    expect(socket.send).not.toHaveBeenCalled()

    setNow(31_000)
    runActiveHeartbeatTick()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(internals.heartbeat.heartbeatProbeSentAt).toBe(31_000)
    client.close()
  })

  it('cleans up the heartbeat interval and visibility listener on close', () => {
    const { client, internals } = makeConnectedClient()
    internals.heartbeat.start()
    const visibilityListener = documentListeners.get('visibilitychange')

    client.close()

    expect(intervalCallbacks.size).toBe(0)
    expect(removeDocumentEventListenerMock).toHaveBeenCalledWith(
      'visibilitychange',
      visibilityListener
    )
    expect(documentListeners.has('visibilitychange')).toBe(false)
  })

  it('does nothing while the socket keeps receiving frames', () => {
    const { internals, socket } = makeConnectedClient()
    // Just under the idle threshold → no probe, no close.
    internals.heartbeat.lastInboundFrameAt = internals.heartbeat.lastHeartbeatTickAt - 24_000
    internals.heartbeat.lastHeartbeatTickAt = internals.heartbeat.lastHeartbeatTickAt - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('sends a status.get probe after the idle threshold of silence', () => {
    const { internals, socket, setNow } = makeConnectedClient()
    // Normal tick cadence distinguishes 30s inbound silence from loop suspension (idle threshold 25s).
    internals.heartbeat.lastInboundFrameAt = 1_000
    setNow(31_000)
    internals.heartbeat.lastHeartbeatTickAt = 31_000 - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(socket.close).not.toHaveBeenCalled()
    expect(internals.heartbeat.heartbeatProbeSentAt).toBe(31_000)
  })

  it('closes the socket only after a SENT probe goes unanswered (not raw silence)', () => {
    const { internals, socket, setNow } = makeConnectedClient()
    // Tick 1: 30s silence on normal cadence → probe sent.
    internals.heartbeat.lastInboundFrameAt = 1_000
    setNow(31_000)
    internals.heartbeat.lastHeartbeatTickAt = 31_000 - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(socket.close).not.toHaveBeenCalled()
    // Tick 2 (normal cadence later): probe still unanswered past the grace
    // window (20s) → close + reconnect.
    setNow(31_000 + 21_000)
    internals.heartbeat.lastHeartbeatTickAt = 31_000 + 21_000 - 10_000
    internals.heartbeat.runTick()
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(internals.ws).toBeNull()
  })

  it('does NOT close on resume after a long hidden gap — re-probes instead (regression)', () => {
    const { internals, socket, setNow, setVisible } = makeConnectedClient()
    // Tab goes hidden for 10 minutes; the tick loop is suspended meanwhile.
    setVisible(false)
    internals.heartbeat.lastInboundFrameAt = 1_000
    internals.heartbeat.lastHeartbeatTickAt = 1_000
    setNow(1_000 + 600_000)
    // First tick after resume: huge sinceLastTick re-baselines, no false close.
    setVisible(true)
    internals.heartbeat.runTick()
    expect(socket.close).not.toHaveBeenCalled()
    // It re-baselined liveness, so it does not immediately probe either.
    expect(socket.send).not.toHaveBeenCalled()
    expect(internals.heartbeat.heartbeatProbeSentAt).toBeNull()
    expect(internals.heartbeat.lastInboundFrameAt).toBe(1_000 + 600_000)
  })

  it('skips probing while the tab is hidden (battery)', () => {
    const { internals, socket, setNow, setVisible } = makeConnectedClient()
    setVisible(false)
    internals.heartbeat.lastInboundFrameAt = 1_000
    internals.heartbeat.lastHeartbeatTickAt = 1_000
    setNow(1_000 + 30_000)
    internals.heartbeat.runTick()
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('does not probe when not in the connected state', () => {
    const { internals, socket, setNow } = makeConnectedClient()
    internals.state = 'handshaking'
    internals.heartbeat.lastInboundFrameAt = 1_000
    setNow(1_000 + 30_000)
    internals.heartbeat.lastHeartbeatTickAt = 1_000 + 30_000 - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).not.toHaveBeenCalled()
  })

  it('resets liveness when an inbound frame arrives between ticks', () => {
    const { internals, socket, setNow } = makeConnectedClient()
    internals.heartbeat.lastInboundFrameAt = 1_000
    setNow(31_000)
    internals.heartbeat.lastHeartbeatTickAt = 31_000 - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).toHaveBeenCalledTimes(1)
    // A reply lands: onmessage stamps lastInboundFrameAt and clears the probe.
    internals.heartbeat.lastInboundFrameAt = internals.heartbeat.lastHeartbeatTickAt
    internals.heartbeat.heartbeatProbeSentAt = null
    advanceOneTick(internals, setNow) // 10s later → quiet again, well under idle
    internals.heartbeat.lastHeartbeatTickAt = internals.heartbeat.lastHeartbeatTickAt - 10_000
    internals.heartbeat.runTick()
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(socket.close).not.toHaveBeenCalled()
  })
})
