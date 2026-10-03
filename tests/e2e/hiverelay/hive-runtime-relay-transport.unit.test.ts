import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import WebSocket from 'ws'
import nacl from 'tweetnacl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProgrammableHiveRelayMockCell } from './programmable-mock-cell'
import {
  hiveRuntimeRelayWireBinding,
  type HiveRuntimeRelaySocketFactory
} from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-socket'
import { HiveRuntimeRelayControlClient } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-control-client'
import { HiveRuntimeRelayDataTransport } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-data-transport'
import type { HiveRuntimeRelayAssignment } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-types'
import type { ConnectionOpen } from '../../../src/main/hive-runtime-cloud/relay-host/hive-runtime-relay-protocol'
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const stop of cleanup.splice(0).toReversed()) {
    await stop()
  }
})
async function fixture(wrongHello = false, wrongProof = false) {
  const now = Date.now()
  const keys = nacl.box.keyPair()
  const keypair = { ...keys, publicKeyB64: Buffer.from(keys.publicKey).toString('base64') }
  const publicKey = Buffer.from(keys.publicKey).toString('base64url')
  const assignment = {
    context: {
      tuple: {
        runtimeInstanceId: 'runtime-1',
        bootId: randomUUID(),
        authorityGeneration: 1,
        fencingEpoch: 1,
        leaseEpoch: 1
      }
    },
    binding: { relayHostId: 'unused', hostBindingVersion: 1, hostPublicKeyB64: publicKey },
    cellOrigin: 'https://relay.hivekernel.com',
    cellId: 'cell-1',
    cellIncarnationId: randomUUID(),
    assignmentId: randomUUID(),
    assignmentEpoch: 1,
    controlGeneration: 1,
    relayHostId: createHash('sha256').update(keys.publicKey).digest('base64url').slice(0, 16),
    controlLease: 'control-lease-only',
    controlLeaseExpiresAt: now + 120000,
    hostPublicKeyB64: publicKey
  } as HiveRuntimeRelayAssignment
  const clientKey = nacl.box.keyPair().publicKey
  const admission = `e30.e30.${'A'.repeat(86)}`
  const cell = new ProgrammableHiveRelayMockCell({
    cellOrigin: assignment.cellOrigin,
    controlLease: assignment.controlLease,
    binding: hiveRuntimeRelayWireBinding(assignment),
    now: () => now,
    admissionGrants: [
      {
        token: admission,
        binding: hiveRuntimeRelayWireBinding(assignment),
        origin: null,
        expiresAtMs: now + 60000,
        clientPublicKeyB64: Buffer.from(clientKey).toString('base64url'),
        clientKeyHash: createHash('sha256').update(clientKey).digest('base64url'),
        intentId: randomUUID()
      }
    ],
    ...(wrongHello
      ? {
          relayHelloBindingOverride: {
            cellId: 'wrong-cell',
            cellIncarnationId: assignment.cellIncarnationId
          }
        }
      : {})
  })
  await cell.start()
  cleanup.push(() => cell.stop())
  const urls: string[] = []
  const leases: (string | undefined)[] = []
  const createSocket: HiveRuntimeRelaySocketFactory = (url, lease) => {
    urls.push(url)
    leases.push(lease)
    return new WebSocket(cell.baseUrl.replace('http:', 'ws:') + new URL(url).pathname, {
      headers: lease ? { authorization: `Bearer ${lease}` } : {},
      perMessageDeflate: false
    })
  }
  let open!: (value: ConnectionOpen) => void
  const opened = new Promise<ConnectionOpen>((resolve) => {
    open = resolve
  })
  const control = new HiveRuntimeRelayControlClient({
    assignment,
    keypair: wrongProof ? { ...keypair, secretKey: nacl.box.keyPair().secretKey } : keypair,
    onConnectionOpen: open,
    onClose: vi.fn(),
    onDrain: vi.fn(),
    createSocket,
    now: () => now
  })
  cleanup.push(() => control.close())
  async function client() {
    const socket = new WebSocket(
      `${cell.baseUrl.replace('http:', 'ws:')}/v1/connect/${assignment.relayHostId}`
    )
    cleanup.push(() => socket.terminate())
    await once(socket, 'open')
    socket.send(
      JSON.stringify({
        type: 'relay-auth',
        v: 2,
        clientAdmissionToken: admission,
        clientPublicKeyB64: Buffer.from(clientKey).toString('base64url')
      })
    )
    return { socket, connection: await opened }
  }
  return { assignment, control, client, cell, createSocket, urls, leases }
}
describe('production HiveRelay control and data against programmable Cell', () => {
  it('proves the Host, attaches once and forwards bytes without logging credentials', async () => {
    const f = await fixture()
    await f.control.connect()
    const { socket, connection } = await f.client()
    let ready!: () => void
    const established = new Promise<void>((resolve) => {
      ready = resolve
    })
    let received!: (bytes: string | Uint8Array<ArrayBufferLike>) => void
    const forwarded = new Promise<string | Uint8Array<ArrayBufferLike>>((resolve) => {
      received = resolve
    })
    const data = new HiveRuntimeRelayDataTransport({
      assignment: f.assignment,
      connection,
      isCurrent: () => true,
      onReady: ready,
      onMessage: received,
      onClose: vi.fn(),
      createSocket: f.createSocket
    })
    cleanup.push(() => data.close())
    data.connect()
    await established
    socket.send(Buffer.from('opaque-encrypted-canary'), { binary: true })
    expect(Buffer.from(await forwarded)).toEqual(Buffer.from('opaque-encrypted-canary'))
    expect(() => data.connect()).toThrow('data_started')
    expect(f.urls).toHaveLength(2)
    expect(f.leases).toEqual([f.assignment.controlLease, undefined])
    const diagnostics = JSON.stringify({ events: f.cell.events, urls: f.urls })
    for (const secret of [
      f.assignment.controlLease,
      connection.connTicket,
      'opaque-encrypted-canary'
    ]) {
      expect(diagnostics).not.toContain(secret)
    }
  })
  it('rejects a forged Host proof', async () => {
    const f = await fixture(false, true)
    await expect(f.control.connect()).rejects.toThrow('control_closed')
    expect(f.cell.events.some((event) => event.kind === 'host-active')).toBe(false)
  })
  it('rejects relay-hello with a different Cell binding and does not retry connTicket', async () => {
    const f = await fixture(true)
    await f.control.connect()
    const { connection } = await f.client()
    let closed!: () => void
    const close = new Promise<void>((resolve) => {
      closed = resolve
    })
    const onReady = vi.fn()
    const data = new HiveRuntimeRelayDataTransport({
      assignment: f.assignment,
      connection,
      isCurrent: () => true,
      onReady,
      onMessage: vi.fn(),
      onClose: closed,
      createSocket: f.createSocket
    })
    cleanup.push(() => data.close())
    data.connect()
    await close
    expect(onReady).not.toHaveBeenCalled()
    expect(f.urls.filter((url) => url.includes('/data/'))).toHaveLength(1)
  })
  it('does not extend the active lease while a refresh acknowledgement is missing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const f = await fixture()
      await f.control.connect()
      vi.advanceTimersByTime(119000)
      const refresh = f.control.refresh({
        ...f.assignment,
        controlLeaseExpiresAt: f.assignment.controlLeaseExpiresAt + 120000
      })
      vi.advanceTimersByTime(1000)
      await expect(refresh).rejects.toThrow('control_closed')
      expect(f.control.active).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
