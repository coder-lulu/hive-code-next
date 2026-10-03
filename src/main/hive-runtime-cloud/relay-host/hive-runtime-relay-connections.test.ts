import nacl from 'tweetnacl'
import { expect, it, vi } from 'vitest'
import type { HiveRuntimeRelayDataTransport } from './hive-runtime-relay-data-transport'
import type { E2EEChannel } from '../../runtime/rpc/e2ee-channel'
import type { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'

const transports = vi.hoisted(
  (): {
    closed: ReturnType<typeof vi.fn>[]
    channels: ReturnType<typeof vi.fn>[]
  } => ({
    closed: [],
    channels: []
  })
)
vi.mock('./hive-runtime-relay-data-transport', () => ({
  HiveRuntimeRelayDataTransport: class {
    close = vi.fn()
    constructor(
      private readonly options: ConstructorParameters<typeof HiveRuntimeRelayDataTransport>[0]
    ) {
      transports.closed.push(this.close)
    }
    connect() {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only the mocked E2EE constructor receives this inert socket; no network operation can run.
      this.options.onReady({} as Parameters<typeof this.options.onReady>[0])
    }
  }
}))
vi.mock('./hive-runtime-relay-account-session', () => ({
  HiveRuntimeRelayAccountSession: class {
    operationCallerKey = 'caller'
    close = vi.fn()
    revalidate = () => true
  }
}))
vi.mock('../../runtime/rpc/e2ee-channel', () => ({
  E2EEChannel: class {
    destroy = vi.fn()
    constructor(_ws: unknown, options: ConstructorParameters<typeof E2EEChannel>[1]) {
      transports.channels.push(this.destroy)
      options.onAccountReady?.(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This isolated channel double only exercises connection cleanup, never encrypted RPC.
        this as unknown as E2EEChannel,
        {
          principalKind: 'account_runtime_session',
          runtimeSessionId: 'session',
          expiresAt: Date.now() + 60_000
        }
      )
    }
  }
}))
import { HiveRuntimeRelayConnections } from './hive-runtime-relay-connections'

it.each(['detach', 'channel'])(
  'closes every Relay transport when the first %s cleanup fails',
  (failure) => {
    transports.closed.length = 0
    transports.channels.length = 0
    const detachFirst = vi.fn(() => {
      if (failure === 'detach') {
        throw new Error('cleanup failed')
      }
    })
    const detachSecond = vi.fn()
    const raw = nacl.box.keyPair()
    const connections = new HiveRuntimeRelayConnections({
      client: { consume: vi.fn() },
      getKeypair: () => ({ ...raw, publicKeyB64: Buffer.from(raw.publicKey).toString('base64') }),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The mocked account session never uses persistence; this fixture only supplies the admission property.
      getOutbox: () => ({ canAccept: true }) as HiveRuntimeRelaySessionTransitionOutbox,
      isCurrent: () => true,
      getSessionAuthorityUntil: () => Date.now() + 60_000,
      requestHeartbeat: vi.fn(),
      onPersistenceFailure: vi.fn(),
      attachRpc: vi.fn().mockReturnValueOnce(detachFirst).mockReturnValueOnce(detachSecond)
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The transport and account-session doubles consume only relayHostId; no Cloud authorization is created.
    const assignment = { relayHostId: 'host' } as HiveRuntimeRelayAssignment
    for (const connId of ['first', 'second']) {
      const connection: ConnectionOpen = {
        type: 'conn-open',
        v: 2,
        kind: 'ticket',
        connId,
        connTicket: 'A'.repeat(43),
        intentId: '123e4567-e89b-42d3-a456-426614174000',
        clientKeyHash: 'B'.repeat(43),
        assignmentEpoch: 1,
        controlGeneration: 1,
        attachDeadlineMs: 5_000
      }
      connections.open(assignment, connection)
    }
    expect(connections.count).toBe(2)
    if (failure === 'channel') {
      transports.channels[0].mockImplementation(() => {
        throw new Error('cleanup failed')
      })
    }
    expect(() => connections.close()).toThrow('cleanup failed')
    expect(connections.count).toBe(0)
    expect(detachFirst).toHaveBeenCalledOnce()
    expect(detachSecond).toHaveBeenCalledOnce()
    for (const close of transports.closed) {
      expect(close).toHaveBeenCalledOnce()
    }
  }
)
