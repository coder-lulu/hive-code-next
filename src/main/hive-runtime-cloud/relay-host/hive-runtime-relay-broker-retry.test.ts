import { EventEmitter } from 'node:events'
import nacl from 'tweetnacl'
import type WebSocket from 'ws'
import { afterEach, expect, it, vi } from 'vitest'
import { HiveRuntimeRelayBroker } from './hive-runtime-relay-broker'
import {
  HiveRuntimeCloudRequestError,
  HiveRuntimeCloudTransportError
} from '../hive-runtime-cloud-http-client'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import limits from '../../../../config/hiverelay-contract/registries/limits.json'

// Keep the real control state machine; cryptographic proof vectors have separate coverage.
vi.mock('./hive-runtime-relay-host-proof-v2', () => ({
  answerHostChallenge: () => ({
    type: 'host-challenge-ack',
    v: 2,
    challengeId: 'challenge-1',
    proofB64: 'A'.repeat(43)
  })
}))

class Socket extends EventEmitter {
  readyState = 1
  bufferedAmount = 0
  send = vi.fn((_value: string, callback: (error?: Error) => void) => callback())
  close = vi.fn(() => {
    this.readyState = 3
    this.emit('close', 1000)
  })
  terminate = vi.fn(() => {
    this.readyState = 3
  })

  receive(value: object): void {
    this.emit('message', Buffer.from(JSON.stringify(value)), false)
  }
}

afterEach(() => vi.useRealTimers())

it.each([
  new HiveRuntimeCloudRequestError(403, 'forbidden'),
  new HiveRuntimeCloudRequestError(503, 'relay_unavailable', 2_000),
  new HiveRuntimeCloudTransportError()
])(
  'withdraws active control on refresh failure and re-handshakes after recovery: %s',
  async (error) => {
    const { broker, assignment, resolve, refresh, sockets } = fixture()
    try {
      broker.start()
      await vi.advanceTimersByTimeAsync(0)
      await finishHandshake(sockets[0], assignment)
      expect(broker.activeAssignment).not.toBeNull()
      refresh.mockRejectedValueOnce(error)
      await vi.advanceTimersByTimeAsync(15_000)
      expect(broker.activeAssignment).toBeNull()
      expect(sockets[0].close).toHaveBeenCalledOnce()
      const delay =
        error instanceof HiveRuntimeCloudRequestError && error.retryAfterMs
          ? error.retryAfterMs
          : 750
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(resolve).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      expect(resolve).toHaveBeenCalledTimes(2)
      expect(broker.activeAssignment).toBeNull()
      await finishHandshake(sockets[1], assignment)
      expect(broker.activeAssignment).not.toBeNull()
    } finally {
      await broker.stop()
      expect(vi.getTimerCount()).toBe(0)
    }
  }
)

function fixture(controlLeaseRemainingMs = 60_000) {
  vi.useFakeTimers()
  vi.setSystemTime(1_800_000_000_000)
  const keys = nacl.box.keyPair()
  const assignment: HiveRuntimeRelayAssignment = {
    context: {
      authorityId: 'hive-primary',
      identity: {
        schemaVersion: 1,
        runtimeInstanceId: 'runtime-1',
        privateKeyPkcs8: 'unused',
        publicKey: 'A'.repeat(43),
        createdAt: 1
      },
      tuple: {
        authorityGeneration: 1,
        runtimeRecordId: 'record-1',
        runtimeInstanceId: 'runtime-1',
        bootId: '10000000-0000-4000-8000-000000000001',
        heartbeatLeaseId: 'lease-1',
        leaseEpoch: 1,
        fencingEpoch: 1
      }
    },
    binding: {
      relayHostId: 'abcdefghijklmnop',
      hostBindingVersion: 1,
      hostPublicKeyB64: 'A'.repeat(43)
    },
    cellOrigin: 'https://cell.example',
    cellId: 'cell-1',
    cellIncarnationId: '10000000-0000-4000-8000-000000000002',
    assignmentId: '10000000-0000-4000-8000-000000000003',
    assignmentEpoch: 1,
    controlGeneration: 1,
    relayHostId: 'abcdefghijklmnop',
    controlLease: 'initial' as HiveRuntimeRelayAssignment['controlLease'],
    controlLeaseExpiresAt: Date.now() + controlLeaseRemainingMs,
    hostPublicKeyB64: 'A'.repeat(43)
  }
  const sockets: Socket[] = []
  const resolve = vi.fn(async () => assignment)
  const refresh = vi.fn(async () => ({
    ...assignment,
    controlLeaseExpiresAt: Date.now() + 60_000
  }))
  const broker = new HiveRuntimeRelayBroker({
    provider: { resolve, refresh },
    getContext: () => assignment.context,
    getKeypair: () => ({ ...keys, publicKeyB64: Buffer.from(keys.publicKey).toString('base64') }),
    onAssigned: vi.fn(),
    onConnection: vi.fn(),
    onUnavailable: vi.fn(),
    random: () => 0.5,
    now: Date.now,
    createSocket: () => {
      const socket = new Socket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }
  })
  return { broker, assignment, resolve, refresh, sockets }
}

it('renews 60-second control leases before the Cell clock-safety cutoff despite HTTP latency', async () => {
  const { broker, assignment, refresh, sockets } = fixture()
  let cellTimer: ReturnType<typeof setTimeout> | undefined
  let cellExpirations = 0
  let nextExpiresAt = assignment.controlLeaseExpiresAt
  const armCellDeadline = (socket: Socket) => {
    if (cellTimer) {
      clearTimeout(cellTimer)
    }
    cellTimer = setTimeout(
      () => {
        cellExpirations += 1
        socket.emit('close', 4410)
      },
      nextExpiresAt - Date.now() - limits.time.clockSkewSeconds * 1000
    )
  }
  refresh.mockImplementation(async () => {
    await new Promise((done) => setTimeout(done, 100))
    // Cloud signs whole JWT seconds, so a refresh can lose a fractional second.
    nextExpiresAt = Math.floor((Date.now() + 60_000) / 1000) * 1000
    return { ...assignment, controlLeaseExpiresAt: nextExpiresAt }
  })
  try {
    broker.start()
    await vi.advanceTimersByTimeAsync(0)
    const socket = sockets[0]
    await finishHandshake(socket, assignment)
    armCellDeadline(socket)
    socket.send.mockImplementation((raw, callback) => {
      callback()
      if (JSON.parse(raw).type === 'auth-refresh') {
        armCellDeadline(socket)
        socket.receive({
          type: 'host-hello-ack',
          v: 2,
          controlGeneration: assignment.controlGeneration,
          leaseExpiresAt: nextExpiresAt
        })
      }
    })
    await vi.advanceTimersByTimeAsync(35_000)
    expect(cellExpirations).toBe(0)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
    expect(broker.activeAssignment).not.toBeNull()
  } finally {
    if (cellTimer) {
      clearTimeout(cellTimer)
    }
    await broker.stop()
    expect(vi.getTimerCount()).toBe(0)
  }
})

it.each([30_000, 30_500])(
  'bounds renewal when only %s ms of nominal lease remains',
  async (remaining) => {
    const { broker, assignment, refresh, sockets } = fixture(remaining)
    try {
      broker.start()
      await vi.advanceTimersByTimeAsync(0)
      await finishHandshake(sockets[0], assignment)
      await vi.advanceTimersByTimeAsync(999)
      expect(refresh).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(refresh).toHaveBeenCalledOnce()
    } finally {
      await broker.stop()
      expect(vi.getTimerCount()).toBe(0)
    }
  }
)

async function finishHandshake(
  socket: Socket,
  assignment: HiveRuntimeRelayAssignment,
  closeAfterAck = false
) {
  socket.emit('open')
  socket.receive({
    type: 'host-challenge',
    v: 2,
    challengeId: 'challenge-1',
    relayEphemeralPublicKeyB64: 'A'.repeat(43),
    nonceB64: 'A'.repeat(32),
    ciphertextB64: 'AAAA',
    expiresAt: Date.now() + 5_000
  })
  socket.receive({
    type: 'host-hello-ack',
    v: 2,
    controlGeneration: assignment.controlGeneration,
    leaseExpiresAt: assignment.controlLeaseExpiresAt
  })
  if (closeAfterAck) {
    socket.emit('close', 1006)
  }
  await vi.advanceTimersByTimeAsync(0)
}

it.each([
  ['connect', 'error'],
  ['connect', 'timeout'],
  ['refresh', 'error'],
  ['refresh', 'timeout'],
  ['active', 'error'],
  ['active', 'close']
] as const)('counts one %s handshake %s once for retry', async (phase, failure) => {
  const { broker, assignment, resolve, refresh, sockets } = fixture()
  try {
    broker.start()
    await vi.advanceTimersByTimeAsync(0)
    const socket = sockets[0]
    if (phase !== 'connect') {
      await finishHandshake(socket, assignment)
      expect(broker.activeAssignment).not.toBeNull()
    }
    if (phase === 'refresh') {
      await vi.advanceTimersByTimeAsync(15_000)
      expect(refresh).toHaveBeenCalledOnce()
    }
    if (failure === 'timeout') {
      await vi.advanceTimersByTimeAsync(5_000)
    } else {
      if (failure === 'close') {
        socket.emit('close', 1006)
      } else {
        socket.emit('error', new Error('connection reset'))
      }
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(broker.activeAssignment).toBeNull()
    await vi.advanceTimersByTimeAsync(749)
    expect(resolve).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(resolve).toHaveBeenCalledTimes(2)
  } finally {
    await broker.stop()
    expect(vi.getTimerCount()).toBe(0)
  }
})

it('retries when the peer closes immediately after acknowledging the handshake', async () => {
  const { broker, assignment, resolve, sockets } = fixture()
  try {
    broker.start()
    await vi.advanceTimersByTimeAsync(0)
    await finishHandshake(sockets[0], assignment, true)
    expect(broker.activeAssignment).toBeNull()
    await vi.advanceTimersByTimeAsync(749)
    expect(resolve).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(resolve).toHaveBeenCalledTimes(2)
  } finally {
    await broker.stop()
    expect(vi.getTimerCount()).toBe(0)
  }
})
