import { beforeEach, expect, it, vi } from 'vitest'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type {
  HiveRuntimeRelayHeartbeatContributor,
  HiveRuntimeRelayHeartbeatResponseControl
} from './hive-runtime-relay-heartbeat-types'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud-presence-service'
import type { HiveRuntimeRelayBroker } from './hive-runtime-relay-broker'
import type { HiveRuntimeRelayConnections } from './hive-runtime-relay-connections'
import type { HiveRuntimeRelayTransitionSettlement } from './hive-runtime-relay-session-transition-types'
type BrokerOptions = ConstructorParameters<typeof HiveRuntimeRelayBroker>[0]
type ConnectionOptions = ConstructorParameters<typeof HiveRuntimeRelayConnections>[0]
type BrokerMock = Pick<
  HiveRuntimeRelayBroker,
  'start' | 'stop' | 'isCurrent' | 'notifyContextChanged' | 'reconnect'
> & {
  activeAssignment: HiveRuntimeRelayAssignment | null
  options: BrokerOptions
}
type ConnectionsMock = Pick<
  HiveRuntimeRelayConnections,
  'close' | 'open' | 'revoke' | 'refreshAuthority'
> & { options: ConnectionOptions; count: number }

const mock = vi.hoisted(() => ({
  broker: null as unknown as BrokerMock,
  connections: null as unknown as ConnectionsMock,
  outbox: {
    initializeCursor: vi.fn(),
    snapshot: vi.fn(() => []),
    acknowledge: vi.fn(() => [] as HiveRuntimeRelayTransitionSettlement[]),
    enqueue: vi.fn(),
    close: vi.fn()
  }
}))
vi.mock('./hive-runtime-relay-broker', () => ({
  HiveRuntimeRelayBroker: class {
    activeAssignment: HiveRuntimeRelayAssignment | null = null
    constructor(readonly options: BrokerOptions) {
      mock.broker = this
    }
    start = vi.fn()
    notifyContextChanged = vi.fn()
    isCurrent = vi.fn(() => true)
    stop = vi.fn(async () => {
      this.activeAssignment = null
      this.options.onUnavailable()
    })
    reconnect = vi.fn()
  }
}))
vi.mock('./hive-runtime-relay-connections', () => ({
  HiveRuntimeRelayConnections: class {
    count = 0
    constructor(readonly options: ConnectionOptions) {
      mock.connections = this
    }
    close = vi.fn()
    open = vi.fn()
    revoke = vi.fn()
    refreshAuthority = vi.fn()
  }
}))
vi.mock('./hive-runtime-relay-storage', () => ({
  createHiveRuntimeRelayBindingStore: () => ({}),
  openHiveRuntimeRelayOutbox: () => mock.outbox
}))
import { HiveRuntimeRelayHostService } from './hive-runtime-relay-host-service'

beforeEach(() => {
  vi.clearAllMocks()
  mock.outbox.acknowledge.mockReturnValue([])
})
function fixture(
  dynamicRegion = false,
  measureRegions?: NonNullable<
    ConstructorParameters<typeof HiveRuntimeRelayHostService>[0]['measureRegions']
  >
) {
  let contributor: HiveRuntimeRelayHeartbeatContributor | null = null
  const unsubscribe = vi.fn()
  const presence = {
    getCurrentLeaseContext: vi.fn(),
    requestHeartbeat: vi.fn(),
    setRelayHeartbeatContributor: vi.fn((value) => {
      contributor = value
    }),
    subscribeLeaseContext: vi.fn(() => unsubscribe)
  }
  const host = new HiveRuntimeRelayHostService({
    apiBaseUrl: 'https://api.hivekernel.com',
    storageDirectory: '/unused',
    requestedRegion: dynamicRegion ? undefined : 'cn-shanghai',
    ...(measureRegions ? { measureRegions } : {}),
    presence: presence as unknown as HiveRuntimeCloudPresenceService,
    getKeypair: () => null,
    attachRpc: () => () => {}
  })
  const assignment = {
    assignmentId: 'assignment-1',
    assignmentEpoch: 1,
    controlGeneration: 1,
    cellId: 'cell-1',
    cellIncarnationId: 'incarnation-1',
    cellOrigin: 'https://cell.example',
    relayHostId: 'abcdefghijklmnop',
    context: {
      authorityId: 'authority-1',
      identity: {},
      tuple: {
        runtimeInstanceId: 'runtime-1',
        bootId: 'boot-1',
        authorityGeneration: 1,
        leaseEpoch: 1,
        fencingEpoch: 1
      }
    }
  } as HiveRuntimeRelayAssignment
  host.start()
  mock.broker.options.onAssigned(assignment)
  return { host, assignment, contributor: contributor!, presence, unsubscribe }
}
function response(): HiveRuntimeRelayHeartbeatResponseControl & { observedAt: number } {
  return {
    responseVersion: 'runtime-session-control/v1',
    observedAt: Date.now(),
    sessionAuthorityUntil: Date.now() + 60_000,
    regionMeasurementWindow: null,
    ackedSessionTransitionSequence: 0,
    sessionTransitionResults: [],
    ackedControlSequence: 0,
    controlCommands: [],
    nextControlSequence: 1
  }
}

it('advertises only after control ACK and closes resources through shared stop', async () => {
  const f = fixture()
  expect(f.contributor.snapshot(f.assignment.context)?.advertiseRelay).toBe(false)
  mock.broker.activeAssignment = f.assignment
  expect(
    f.contributor.snapshot(f.assignment.context)?.relayControl.controlConnectionAcknowledged
  ).toBe(true)
  expect(mock.connections.options.isCurrent({ ...f.assignment, assignmentEpoch: 2 })).toBe(false)
  expect(mock.connections.options.isCurrent(f.assignment)).toBe(false)
  await f.host.stop()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
  expect(mock.connections.close).toHaveBeenCalledOnce()
  expect(mock.outbox.close).toHaveBeenCalledOnce()
  expect(f.presence.setRelayHeartbeatContributor).toHaveBeenLastCalledWith(null)
})

it('establishes the fresh cursor before opening signed session authority', () => {
  const f = fixture()
  mock.broker.activeAssignment = f.assignment
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  const accepted = { ...response(), ackedSessionTransitionSequence: 226 }
  mock.outbox.initializeCursor.mockImplementationOnce(() => {
    expect(mock.connections.options.getSessionAuthorityUntil()).toBeNull()
    expect(mock.connections.options.isCurrent(f.assignment)).toBe(false)
  })
  f.contributor.accept(f.assignment.context, accepted, sent)
  expect(mock.outbox.initializeCursor).toHaveBeenCalledWith({
    ackedSessionTransitionSequence: 226,
    sessionTransitionResults: []
  })
  expect(mock.connections.options.getSessionAuthorityUntil()).toBe(accepted.sessionAuthorityUntil)
  expect(mock.connections.options.isCurrent(f.assignment)).toBe(true)
  expect(mock.outbox.initializeCursor.mock.invocationCallOrder[0]).toBeLessThan(
    mock.outbox.acknowledge.mock.invocationCallOrder[0]
  )
})

it('keeps session authority closed when initial cursor persistence fails', () => {
  const f = fixture()
  mock.broker.activeAssignment = f.assignment
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  mock.outbox.initializeCursor.mockImplementationOnce(() => {
    throw new Error('write_failed')
  })
  f.contributor.accept(
    f.assignment.context,
    { ...response(), ackedSessionTransitionSequence: 226 },
    sent
  )
  expect(mock.connections.options.getSessionAuthorityUntil()).toBeNull()
  expect(mock.broker.stop).toHaveBeenCalledOnce()
  expect(mock.connections.refreshAuthority).not.toHaveBeenCalled()
})

it('ACKs each next command rather than skipping to the end of a response batch', () => {
  const f = fixture()
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  const commands = [1, 2].map((sequence) => ({
    sequence,
    commandId: `command-${sequence}`,
    commandType: 'SESSION_REVOKE' as const,
    managedSessionId: `session-${sequence}`,
    assignmentId: f.assignment.assignmentId,
    assignmentEpoch: null,
    targetResourceVersion: sequence,
    targetControlVersion: 1,
    reason: 'ADMINISTRATIVE' as const,
    targetRegion: null
  }))
  f.contributor.accept(
    f.assignment.context,
    { ...response(), controlCommands: commands, nextControlSequence: 3 },
    sent
  )
  expect(
    f.contributor.snapshot(f.assignment.context)?.relayControl.controlCommandAck?.sequence
  ).toBe(1)
  f.contributor.accept(
    f.assignment.context,
    {
      ...response(),
      ackedControlSequence: 1,
      controlCommands: [commands[1]],
      nextControlSequence: 3
    },
    sent
  )
  expect(
    f.contributor.snapshot(f.assignment.context)?.relayControl.controlCommandAck?.sequence
  ).toBe(2)
})

it('rejects old assignment and Cell incarnation responses before authority or outbox delivery', () => {
  const f = fixture()
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  for (const stale of [
    { ...sent, assignmentId: 'old' },
    { ...sent, cellIncarnationId: 'old' },
    { ...sent, cellId: 'old' }
  ]) {
    f.contributor.accept(f.assignment.context, response(), stale)
  }
  expect(mock.outbox.acknowledge).not.toHaveBeenCalled()
  expect(mock.connections.refreshAuthority).not.toHaveBeenCalled()
})

it('ACKs obsolete assignment commands without revoking current assignment connections', () => {
  const f = fixture()
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  f.contributor.accept(
    f.assignment.context,
    {
      ...response(),
      nextControlSequence: 2,
      controlCommands: [
        {
          sequence: 1,
          commandId: 'command-1',
          commandType: 'SESSION_REVOKE',
          managedSessionId: 'session-1',
          assignmentId: 'other',
          assignmentEpoch: null,
          targetResourceVersion: 1,
          targetControlVersion: 1,
          reason: 'ADMINISTRATIVE',
          targetRegion: null
        }
      ]
    },
    sent
  )
  expect(mock.connections.revoke).not.toHaveBeenCalled()
  expect(
    f.contributor.snapshot(f.assignment.context)?.relayControl.controlCommandAck?.sequence
  ).toBe(1)
})

it('defers rehome while busy and reconnects only after the idle ACK is accepted', () => {
  const f = fixture(true)
  mock.broker.activeAssignment = f.assignment
  mock.connections.count = 1
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  const command = {
    sequence: 1,
    commandId: 'command-rehome',
    commandType: 'RELAY_REHOME' as const,
    managedSessionId: null,
    assignmentId: f.assignment.assignmentId,
    assignmentEpoch: f.assignment.assignmentEpoch,
    targetResourceVersion: 1,
    targetControlVersion: null,
    reason: null,
    targetRegion: 'cn-beijing'
  }
  f.contributor.accept(
    f.assignment.context,
    { ...response(), controlCommands: [command], nextControlSequence: 2 },
    sent
  )
  expect(mock.connections.options.canAccept?.()).toBe(false)
  expect(f.contributor.snapshot(f.assignment.context)?.relayControl.controlCommandAck).toBeNull()
  expect(mock.broker.reconnect).not.toHaveBeenCalled()

  mock.connections.count = 0
  mock.connections.options.onIdle?.()
  const acknowledging = f.contributor.snapshot(f.assignment.context)!.relayControl
  expect(acknowledging.controlCommandAck).toEqual({
    sequence: 1,
    commandId: command.commandId,
    acknowledgedResourceVersion: 1
  })
  expect(mock.broker.reconnect).not.toHaveBeenCalled()

  f.contributor.accept(
    f.assignment.context,
    { ...response(), ackedControlSequence: 1, nextControlSequence: 2 },
    acknowledging
  )
  expect(mock.broker.reconnect).toHaveBeenCalledOnce()
  expect(mock.connections.options.canAccept?.()).toBe(false)

  mock.broker.options.onAssigned({
    ...f.assignment,
    assignmentId: 'assignment-2',
    assignmentEpoch: 2
  })
  expect(mock.connections.options.canAccept?.()).toBe(true)
})

it('keeps an administrator region override out of measurement and rehome', () => {
  const measureRegions = vi.fn(async () => {
    throw new Error('administrator override must not measure regions')
  })
  const f = fixture(false, measureRegions)
  mock.broker.activeAssignment = f.assignment
  const sent = f.contributor.snapshot(f.assignment.context)!.relayControl
  f.contributor.accept(
    f.assignment.context,
    {
      ...response(),
      nextControlSequence: 2,
      regionMeasurementWindow: {
        policyVersion: 1,
        generation: 1,
        expiresAt: Date.now() + 60_000,
        assignmentId: f.assignment.assignmentId,
        assignmentEpoch: f.assignment.assignmentEpoch,
        incumbentRegion: 'cn-shanghai',
        candidates: [
          { region: 'cn-shanghai', probeUrl: 'https://shanghai.example/' },
          { region: 'cn-beijing', probeUrl: 'https://beijing.example/' }
        ]
      },
      controlCommands: [
        {
          sequence: 1,
          commandId: 'command-rehome',
          commandType: 'RELAY_REHOME',
          managedSessionId: null,
          assignmentId: f.assignment.assignmentId,
          assignmentEpoch: f.assignment.assignmentEpoch,
          targetResourceVersion: 1,
          targetControlVersion: null,
          reason: null,
          targetRegion: 'cn-beijing'
        }
      ]
    },
    sent
  )

  const next = f.contributor.snapshot(f.assignment.context)!.relayControl
  expect(next.regionSelectionMode).toBe('ADMIN_OVERRIDE')
  expect(next.regionMeasurement).toBeNull()
  expect(next.controlCommandAck).toBeNull()
  expect(measureRegions).not.toHaveBeenCalled()
  expect(mock.broker.reconnect).not.toHaveBeenCalled()
  expect(mock.connections.options.canAccept?.()).toBe(true)
})

it('closes an APPLIED activation recovered without a live socket', () => {
  const f = fixture()
  mock.outbox.acknowledge.mockReturnValue([
    {
      activationEligible: false,
      transition: {
        sequence: 1,
        transitionId: '20000000-0000-4000-8000-000000000001',
        expectedControlVersion: 1,
        occurredAt: Date.now(),
        reason: 'ACTIVATED',
        transitionType: 'ACTIVATE',
        managedSessionId: 'managed-1',
        runtimeSessionId: 'session-1',
        sessionBindingHash: 'hash'
      },
      result: {
        sequence: 1,
        transitionId: '20000000-0000-4000-8000-000000000001',
        stored: true,
        verdict: 'APPLIED',
        resultingStatus: 'ACTIVE',
        resultingControlVersion: 2
      }
    }
  ])
  f.contributor.accept(
    f.assignment.context,
    response(),
    f.contributor.snapshot(f.assignment.context)!.relayControl
  )
  expect(mock.outbox.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      transitionType: 'CLOSE',
      reason: 'TRANSPORT_CLOSED',
      expectedControlVersion: 2,
      managedSessionId: 'managed-1'
    })
  )
  expect(f.presence.requestHeartbeat).toHaveBeenCalled()
})
