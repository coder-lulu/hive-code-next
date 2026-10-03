import nacl from 'tweetnacl'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProgrammableHiveRelayMockCell,
  ReferenceHiveRelayClient,
  ReferenceHiveRelayHost,
  HIVE_RELAY_CLIENT_PATH_PREFIX,
  HIVE_RELAY_HOST_CONTROL_PATH,
  HIVE_RELAY_HOST_DATA_PATH_PREFIX,
  deriveHiveRelayHostId,
  deriveHiveRelayKeyHash,
  type HiveRelayBinding,
  type MockAdmissionGrant
} from './index'
import { parseMockCellRoute } from './hiverelay-mock-cell-server'
import {
  BINARY_INBOX_OVERFLOW_CLOSE,
  BINARY_INBOX_OVERFLOW_REASON,
  BinaryInbox,
  openWebSocket,
  queueBinaryFrame,
  sendJson,
  waitForOpen,
  wireText
} from './hiverelay-websocket-peer'

const CELL_ORIGIN = 'https://cell-a.hiverelay.test'
const CLIENT_ORIGIN = 'https://client.hiverelay.test'
const CONTROL_LEASE = 'test-only-control-lease'

function bindingFor(hostPublicKey: Uint8Array): HiveRelayBinding {
  return {
    cellId: 'cell-a',
    cellIncarnationId: '00000000-0000-4000-8000-000000000007',
    runtimeId: 'runtime-1',
    runtimeBootId: '00000000-0000-4000-8000-000000000004',
    authorityGeneration: 3,
    fencingEpoch: 5,
    leaseEpoch: 6,
    assignmentId: '00000000-0000-4000-8000-000000000001',
    assignmentEpoch: 7,
    controlGeneration: 8,
    relayHostId: deriveHiveRelayHostId(hostPublicKey)
  }
}

function grant(
  token: string,
  binding: HiveRelayBinding,
  clientKeys: nacl.BoxKeyPair
): MockAdmissionGrant {
  return {
    token: tokenFor(token),
    binding,
    origin: CLIENT_ORIGIN,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
    clientPublicKeyB64: Buffer.from(clientKeys.publicKey).toString('base64url'),
    intentId: uuidFor(token),
    clientKeyHash: deriveHiveRelayKeyHash(clientKeys.publicKey)
  }
}

function tokenFor(label: string): string {
  return `${Buffer.from('{"alg":"EdDSA"}').toString('base64url')}.${Buffer.from(label).toString('base64url')}.${'A'.repeat(86)}`
}

function uuidFor(label: string): string {
  const bytes = createHash('sha256').update(label).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

type Harness = {
  cell: ProgrammableHiveRelayMockCell
  host: ReferenceHiveRelayHost
  binding: HiveRelayBinding
}

describe('HiveRelay P0 reference peer wire testkit', () => {
  const cells: ProgrammableHiveRelayMockCell[] = []
  const hosts: ReferenceHiveRelayHost[] = []
  const clients: ReferenceHiveRelayClient[] = []

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close()
    }
    for (const host of hosts.splice(0)) {
      host.close()
    }
    await Promise.all(cells.splice(0).map((cell) => cell.stop()))
  })

  async function startHarness(args: {
    grants: readonly MockAdmissionGrant[]
    hostKeys: nacl.BoxKeyPair
    binding: HiveRelayBinding
    now?: () => number
    autoAttach?: boolean
    holdConnectionOpens?: boolean
    cellBinding?: HiveRelayBinding
    eventCapacity?: number
    relayHelloBindingOverride?: {
      cellId: string
      cellIncarnationId: string
    }
  }): Promise<Harness> {
    const cell = new ProgrammableHiveRelayMockCell({
      cellOrigin: CELL_ORIGIN,
      controlLease: CONTROL_LEASE,
      binding: args.cellBinding ?? args.binding,
      admissionGrants: args.grants,
      now: args.now,
      eventCapacity: args.eventCapacity,
      relayHelloBindingOverride: args.relayHelloBindingOverride,
      holdConnectionOpens: args.holdConnectionOpens
    })
    cells.push(cell)
    await cell.start()
    const host = new ReferenceHiveRelayHost({
      cellUrl: cell.baseUrl,
      cellOrigin: CELL_ORIGIN,
      controlLease: CONTROL_LEASE,
      binding: args.binding,
      keys: args.hostKeys,
      now: args.now,
      autoAttach: args.autoAttach
    })
    hosts.push(host)
    return { cell, host, binding: args.binding }
  }

  function createClient(
    harness: Harness,
    token: string,
    keys: nacl.BoxKeyPair,
    origin = CLIENT_ORIGIN
  ): ReferenceHiveRelayClient {
    const client = new ReferenceHiveRelayClient({
      cellUrl: harness.cell.baseUrl,
      relayHostId: harness.binding.relayHostId,
      clientAdmissionToken: tokenFor(token),
      origin,
      expectedCellId: harness.binding.cellId,
      expectedCellIncarnationId: harness.binding.cellIncarnationId,
      keys
    })
    clients.push(client)
    return client
  }

  it('proves Host ownership, attaches data, and forwards opaque ciphertext both ways', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-happy', binding, clientKeys)]
    })
    await expect(harness.host.connect()).resolves.toMatchObject({
      controlGeneration: binding.controlGeneration
    })
    const client = createClient(harness, 'admission-happy', clientKeys)

    const hello = await client.connect()
    await harness.host.waitForAttached(hello.connId)
    const clientPayload = new Uint8Array([0, 1, 2, 3, 255])
    const hostPayload = new Uint8Array([9, 8, 7, 6])
    client.sendCiphertext(clientPayload)
    harness.host.sendCiphertext(hello.connId, hostPayload)

    await expect(harness.host.nextCiphertext(hello.connId)).resolves.toEqual(clientPayload)
    await expect(client.nextCiphertext()).resolves.toEqual(hostPayload)
    expect(harness.cell.events).toEqual(
      expect.arrayContaining([
        { kind: 'host-active' },
        expect.objectContaining({ kind: 'connection-active', connId: hello.connId }),
        expect.objectContaining({
          kind: 'ciphertext-forwarded',
          direction: 'client-to-host',
          byteLength: clientPayload.byteLength
        }),
        expect.objectContaining({
          kind: 'ciphertext-forwarded',
          direction: 'host-to-client',
          byteLength: hostPayload.byteLength
        })
      ])
    )
  })

  it('expires a held Host attach and releases its admission reservation', async () => {
    let now = 1_000_000
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-timeout', binding, clientKeys)],
      now: () => now,
      autoAttach: false
    })
    await harness.host.connect()
    const client = createClient(harness, 'admission-timeout', clientKeys)
    const connecting = client.connect()
    void connecting.catch(() => {})
    await vi.waitFor(() => expect(harness.cell.pendingConnectionIds()).toHaveLength(1))

    now += 5_001
    harness.cell.expirePending()

    await expect(connecting).rejects.toMatchObject({ reason: 'HOST_ATTACH_TIMEOUT' })
    expect(harness.cell.events.at(-1)).toMatchObject({
      kind: 'connection-released',
      reason: 'HOST_ATTACH_TIMEOUT'
    })
  })

  it.each([
    {
      operation: 'drain completion',
      expectedReason: 'INCARNATION_DRAIN',
      apply: (cell: ProgrammableHiveRelayMockCell) => {
        cell.beginDrain(0)
        cell.finishDrain()
      }
    },
    {
      operation: 'incarnation rotation',
      expectedReason: 'STALE_BINDING',
      apply: (cell: ProgrammableHiveRelayMockCell) =>
        cell.rotateIncarnation('00000000-0000-4000-8000-000000000099')
    }
  ])('releases pending admission on $operation', async ({ operation, expectedReason, apply }) => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const label = `admission-${operation}`
    const token = tokenFor(label)
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant(label, binding, clientKeys)],
      autoAttach: false
    })
    await harness.host.connect()
    const client = createClient(harness, label, clientKeys)
    const connecting = client.connect()
    void connecting.catch(() => {})
    await vi.waitFor(() => expect(harness.cell.pendingConnectionIds()).toHaveLength(1))

    apply(harness.cell)

    await expect(connecting).rejects.toMatchObject({ reason: expectedReason })
    expect(harness.cell.admissionState(token)).toBe('UNUSED')
  })

  it('keeps the authentication deadline active until Host proof is acknowledged', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const cell = new ProgrammableHiveRelayMockCell({
      cellOrigin: CELL_ORIGIN,
      controlLease: CONTROL_LEASE,
      binding,
      admissionGrants: [],
      preAuthTimeoutMs: 100
    })
    cells.push(cell)
    await cell.start()
    const socket = openWebSocket(cell.baseUrl, HIVE_RELAY_HOST_CONTROL_PATH, {
      authorization: CONTROL_LEASE
    })
    const challenge = new Promise<Record<string, unknown>>((resolve, reject) => {
      socket.once('message', (raw, isBinary) => {
        if (isBinary) {
          reject(new Error('Expected a text Host challenge'))
          return
        }
        resolve(JSON.parse(wireText(raw)) as Record<string, unknown>)
      })
      socket.once('error', reject)
    })
    const closed = new Promise<{ code: number; reason: string }>((resolve) => {
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString('utf8') }))
    })
    await waitForOpen(socket)
    sendJson(socket, {
      type: 'host-hello',
      v: 2,
      ...binding,
      hostPublicKeyB64: Buffer.from(hostKeys.publicKey).toString('base64url'),
      capabilities: ['ticket-connect-v2']
    })

    await expect(challenge).resolves.toMatchObject({ type: 'host-challenge' })
    await expect(closed).resolves.toEqual({ code: 4408, reason: 'AUTH_TIMEOUT' })
  })

  it('rejects replay of a consumed admission token', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-once', binding, clientKeys)]
    })
    await harness.host.connect()
    const accepted = createClient(harness, 'admission-once', clientKeys)
    await accepted.connect()
    const replay = createClient(harness, 'admission-once', clientKeys)

    await expect(replay.connect()).rejects.toMatchObject({
      code: 4409,
      reason: 'REPLAY_DETECTED'
    })
  })

  it('rejects a browser client whose Origin differs from its admission binding', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-wrong-origin', binding, clientKeys)]
    })
    await harness.host.connect()
    const client = createClient(
      harness,
      'admission-wrong-origin',
      clientKeys,
      'https://attacker.invalid'
    )

    await expect(client.connect()).rejects.toMatchObject({ code: 4403, reason: 'ORIGIN_REJECTED' })
  })

  it('rejects a relay acknowledgement for a different Cell incarnation', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-wrong-relay-hello', binding, clientKeys)],
      relayHelloBindingOverride: {
        cellId: binding.cellId,
        cellIncarnationId: '99999999-9999-4999-8999-999999999999'
      }
    })
    await harness.host.connect()
    const client = createClient(harness, 'admission-wrong-relay-hello', clientKeys)

    await expect(client.connect()).rejects.toThrow('acknowledgement binding mismatch')
  })

  it('fails a stale Host binding before issuing an active acknowledgement', async () => {
    const hostKeys = nacl.box.keyPair()
    const currentBinding = bindingFor(hostKeys.publicKey)
    const staleBinding = { ...currentBinding, assignmentEpoch: currentBinding.assignmentEpoch - 1 }
    const harness = await startHarness({
      hostKeys,
      binding: staleBinding,
      cellBinding: currentBinding,
      grants: []
    })

    await expect(harness.host.connect()).rejects.toThrow('STALE_BINDING')
    expect(harness.cell.events).not.toContainEqual({ kind: 'host-active' })
  })

  it('binds concurrent clients by connId when conn-open delivery is reversed', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const firstKeys = nacl.box.keyPair()
    const secondKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [
        grant('admission-first', binding, firstKeys),
        grant('admission-second', binding, secondKeys)
      ],
      holdConnectionOpens: true
    })
    await harness.host.connect()
    const first = createClient(harness, 'admission-first', firstKeys)
    const second = createClient(harness, 'admission-second', secondKeys)
    const firstConnecting = first.connect()
    const secondConnecting = second.connect()
    await vi.waitFor(() => expect(harness.cell.pendingConnectionIds()).toHaveLength(2))

    harness.cell.releaseConnectionOpens('reverse')
    const [firstHello, secondHello] = await Promise.all([firstConnecting, secondConnecting])

    expect(harness.host.openedConnectionIds).toEqual([secondHello.connId, firstHello.connId])
    expect(firstHello.connId).toMatch(/^conn-[A-Za-z0-9_-]{22}-1$/)
    expect(secondHello.connId).toMatch(/^conn-[A-Za-z0-9_-]{22}-2$/)
    await Promise.all([
      harness.host.waitForAttached(firstHello.connId),
      harness.host.waitForAttached(secondHello.connId)
    ])
  })

  it('refuses new admission while draining and closes active peers at drain completion', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const activeKeys = nacl.box.keyPair()
    const refusedKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [
        grant('admission-active', binding, activeKeys),
        grant('admission-refused', binding, refusedKeys)
      ]
    })
    await harness.host.connect()
    const active = createClient(harness, 'admission-active', activeKeys)
    const activeHello = await active.connect()
    await harness.host.waitForAttached(activeHello.connId)
    harness.cell.beginDrain(1_000)
    await vi.waitFor(() => expect(harness.host.drainDeadlines).toHaveLength(1))
    const refused = createClient(harness, 'admission-refused', refusedKeys)

    await expect(refused.connect()).rejects.toMatchObject({ code: 4413, reason: 'DRAINING' })
    const stillForwarded = new Uint8Array([4, 2])
    active.sendCiphertext(stillForwarded)
    await expect(harness.host.nextCiphertext(activeHello.connId)).resolves.toEqual(stillForwarded)
    const activeClosed = active.waitForClose()
    harness.cell.finishDrain()
    await expect(activeClosed).resolves.toMatchObject({ code: 4413, reason: 'INCARNATION_DRAIN' })
  })

  it('releases active data peers when the Host control channel disappears', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-control-loss', binding, clientKeys)]
    })
    await harness.host.connect()
    const client = createClient(harness, 'admission-control-loss', clientKeys)
    const hello = await client.connect()
    await harness.host.waitForAttached(hello.connId)

    const closed = client.waitForClose()
    harness.cell.dropControl()

    await expect(closed).resolves.toMatchObject({ code: 4411, reason: 'HOST_UNAVAILABLE' })
    expect(harness.cell.pendingConnectionIds()).toEqual([])
  })

  it('bounds diagnostic event retention', async () => {
    const hostKeys = nacl.box.keyPair()
    const binding = bindingFor(hostKeys.publicKey)
    const clientKeys = nacl.box.keyPair()
    const harness = await startHarness({
      hostKeys,
      binding,
      grants: [grant('admission-bounded-events', binding, clientKeys)],
      eventCapacity: 2
    })
    await harness.host.connect()
    const client = createClient(harness, 'admission-bounded-events', clientKeys)
    await client.connect()

    expect(harness.cell.events).toHaveLength(2)
  })
})

describe('HiveRelay binary inbox bounds', () => {
  it('reuses fixed storage across sustained push/read churn', async () => {
    const inbox = new BinaryInbox(2)
    for (let index = 0; index < 100; index += 1) {
      inbox.push(Buffer.from([index]))
      await expect(inbox.next()).resolves.toEqual(new Uint8Array([index]))
    }
  })

  it('fails closed instead of retaining unbounded ciphertext frames', async () => {
    const inbox = new BinaryInbox(2)
    inbox.push(Buffer.from([1]))
    inbox.push(Buffer.from([2]))
    inbox.push(Buffer.from([3]))

    await expect(inbox.next()).rejects.toThrow('capacity exceeded')
  })

  it('closes the peer when its bounded inbox overflows', () => {
    const close = vi.fn()
    const inbox = new BinaryInbox(1)
    queueBinaryFrame({ close }, inbox, Buffer.from([1]))
    queueBinaryFrame({ close }, inbox, Buffer.from([2]))

    expect(close).toHaveBeenCalledExactlyOnceWith(
      BINARY_INBOX_OVERFLOW_CLOSE,
      BINARY_INBOX_OVERFLOW_REASON
    )
  })

  it('rejects excess pending readers', async () => {
    const inbox = new BinaryInbox(1)
    const first = inbox.next()
    await expect(inbox.next()).rejects.toThrow('waiter capacity exceeded')
    inbox.reject(new Error('closed'))
    await expect(first).rejects.toThrow('closed')
  })
})

describe('HiveRelay mock Cell route parsing', () => {
  it('rejects malformed percent escapes and empty route identifiers', () => {
    expect(parseMockCellRoute(`${HIVE_RELAY_HOST_DATA_PATH_PREFIX}%ZZ`)).toBeNull()
    expect(parseMockCellRoute(`${HIVE_RELAY_CLIENT_PATH_PREFIX}%ZZ`)).toBeNull()
    expect(parseMockCellRoute(HIVE_RELAY_HOST_DATA_PATH_PREFIX)).toBeNull()
    expect(parseMockCellRoute(HIVE_RELAY_CLIENT_PATH_PREFIX)).toBeNull()
  })
})
