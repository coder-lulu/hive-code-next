import { join } from 'node:path'
import type { E2EEKeypair } from '../../runtime/e2ee-keypair'
import type { RuntimeRpcAccountConnection } from '../../runtime/runtime-rpc/runtime-rpc-account-dispatch'
import type { HiveRuntimeCloudPresenceService } from '../hive-runtime-cloud-presence-service'
import { HiveRuntimeRelayAuthorizationProvider } from './hive-runtime-relay-authorization-provider'
import { HiveRuntimeRelayBroker } from './hive-runtime-relay-broker'
import { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import { HiveRuntimeRelayConnections } from './hive-runtime-relay-connections'
import {
  createHiveRuntimeRelayBindingStore,
  openHiveRuntimeRelayOutbox
} from './hive-runtime-relay-storage'
import type { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import {
  hiveRuntimeRelaySameOwner,
  type HiveRuntimeRelaySocketFactory
} from './hive-runtime-relay-socket'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type {
  HiveRuntimeRelayHeartbeatContributor,
  HiveRuntimeRelayControlCommandAck,
  HiveRuntimeRelayRegionMeasurement,
  HiveRuntimeRelayRegionMeasurementWindow
} from './hive-runtime-relay-heartbeat-types'
import { HiveRuntimeRelayRegionController } from './hive-runtime-relay-region-controller'

type Options = {
  apiBaseUrl: string
  storageDirectory: string
  requestedRegion?: string
  presence: HiveRuntimeCloudPresenceService
  getKeypair: () => E2EEKeypair | null
  attachRpc: (connection: RuntimeRpcAccountConnection) => () => void
  client?: HiveRuntimeRelayCloudClient
  createSocket?: HiveRuntimeRelaySocketFactory
  measureRegions?: (
    window: HiveRuntimeRelayRegionMeasurementWindow
  ) => Promise<HiveRuntimeRelayRegionMeasurement>
}

/** Shared process composition; no account UI, paired device, or Desktop relay dependency. */
export class HiveRuntimeRelayHostService {
  private readonly broker: HiveRuntimeRelayBroker
  private readonly connections: HiveRuntimeRelayConnections
  private readonly regions: HiveRuntimeRelayRegionController
  private outbox: HiveRuntimeRelaySessionTransitionOutbox | null = null
  private outboxScope: string | null = null
  private assignment: HiveRuntimeRelayAssignment | null = null
  private authorityUntil: number | null = null
  private commandAck: HiveRuntimeRelayControlCommandAck | null = null
  private unsubscribe: (() => void) | null = null
  private failed = false

  constructor(private readonly options: Options) {
    const client = options.client ?? new HiveRuntimeRelayCloudClient(options.apiBaseUrl)
    this.regions = new HiveRuntimeRelayRegionController({
      dynamic: options.requestedRegion === undefined,
      getAssignment: () => this.assignment,
      getConnectionCount: () => this.connections.count,
      isActive: () => !!this.unsubscribe && !this.failed,
      requestHeartbeat: () => options.presence.requestHeartbeat(),
      reconnect: () => this.broker.reconnect(),
      setCommandAck: (ack) => {
        this.commandAck = ack
      },
      ...(options.measureRegions ? { measureRegions: options.measureRegions } : {})
    })
    const provider = new HiveRuntimeRelayAuthorizationProvider({
      client,
      currentLeaseContext: () => options.presence.getCurrentLeaseContext(),
      requestedRegion: options.requestedRegion,
      bindingStore: createHiveRuntimeRelayBindingStore(join(options.storageDirectory, 'bindings')),
      beforeKeyRotation: () => this.connections.close()
    })
    this.connections = new HiveRuntimeRelayConnections({
      client,
      getKeypair: options.getKeypair,
      getOutbox: () => this.outbox,
      isCurrent: (assignment) => this.authorityUntil !== null && this.isCurrent(assignment),
      getSessionAuthorityUntil: () => this.authorityUntil,
      requestHeartbeat: () => options.presence.requestHeartbeat(),
      onPersistenceFailure: () => this.failClosed(),
      onIdle: () => this.regions.onIdle(),
      canAccept: () => this.regions.canAcceptConnection,
      attachRpc: options.attachRpc,
      createSocket: options.createSocket
    })
    this.broker = new HiveRuntimeRelayBroker({
      provider,
      getContext: () => options.presence.getCurrentLeaseContext(),
      getKeypair: options.getKeypair,
      createSocket: options.createSocket,
      onAssigned: (assignment) => this.assigned(assignment),
      onConnection: (assignment, connection) => this.connections.open(assignment, connection),
      onUnavailable: () => {
        this.authorityUntil = null
        try {
          this.connections.close()
        } finally {
          options.presence.requestHeartbeat()
        }
      }
    })
  }

  getStatus(): 'registered' | 'connecting' | 'offline' {
    if (!this.unsubscribe || this.failed || !this.options.presence.getCurrentLeaseContext()) {
      return 'offline'
    }
    return this.broker.activeAssignment ? 'registered' : 'connecting'
  }

  start(): void {
    if (this.unsubscribe || this.failed) {
      return
    }
    this.options.presence.setRelayHeartbeatContributor(this.contributor)
    this.unsubscribe = this.options.presence.subscribeLeaseContext(() =>
      this.broker.notifyContextChanged()
    )
    this.broker.start()
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.regions.stop()
    await this.broker.stop()
    this.options.presence.setRelayHeartbeatContributor(null)
    this.outbox?.close()
    this.outbox = null
  }

  private isCurrent(assignment: HiveRuntimeRelayAssignment): boolean {
    const active = this.broker.activeAssignment
    return !this.failed && !!active && hiveRuntimeRelaySameOwner(active, assignment)
  }

  private assigned(assignment: HiveRuntimeRelayAssignment): void {
    try {
      const previous = this.assignment
      const ownerChanged = !!previous && !hiveRuntimeRelaySameOwner(previous, assignment)
      const scope = `${assignment.context.tuple.runtimeInstanceId}:${assignment.context.tuple.bootId}`
      if (scope !== this.outboxScope) {
        this.outbox?.close()
        this.outbox = openHiveRuntimeRelayOutbox(
          join(this.options.storageDirectory, 'transitions'),
          assignment.context
        )
        this.outboxScope = scope
        this.commandAck = null
      }
      this.assignment = assignment
      this.regions.assigned(ownerChanged)
      this.options.presence.requestHeartbeat()
    } catch {
      this.failClosed()
    }
  }

  private failClosed(): void {
    if (this.failed) {
      return
    }
    this.failed = true
    this.regions.stop()
    this.connections.close()
    void this.broker.stop()
  }

  private readonly contributor: HiveRuntimeRelayHeartbeatContributor = {
    snapshot: (context) => {
      const assignment = this.assignment
      if (
        this.failed ||
        !assignment ||
        !this.outbox ||
        !this.broker.isCurrent(assignment) ||
        context.tuple.bootId !== assignment.context.tuple.bootId
      ) {
        return null
      }
      const active = this.isCurrent(assignment)
      return {
        advertiseRelay: active,
        relayControl: {
          assignmentId: assignment.assignmentId,
          cellId: assignment.cellId,
          cellIncarnationId: assignment.cellIncarnationId,
          assignmentEpoch: assignment.assignmentEpoch,
          controlGeneration: assignment.controlGeneration,
          controlConnectionAcknowledged: active,
          controlCommandAck: this.commandAck,
          sessionTransitions: this.outbox.snapshot(),
          activeConnectionCount: this.connections.count,
          regionSelectionMode:
            this.options.requestedRegion === undefined ? 'DYNAMIC' : 'ADMIN_OVERRIDE',
          regionMeasurement: this.regions.reportedMeasurement
        }
      }
    },
    accept: (_context, response, sent) => {
      const assignment = this.assignment
      if (
        this.failed ||
        !assignment ||
        !this.outbox ||
        !this.broker.isCurrent(assignment) ||
        sent.assignmentId !== assignment.assignmentId ||
        sent.cellId !== assignment.cellId ||
        sent.cellIncarnationId !== assignment.cellIncarnationId ||
        sent.assignmentEpoch !== assignment.assignmentEpoch ||
        sent.controlGeneration !== assignment.controlGeneration
      ) {
        return
      }
      try {
        const sentAck = sent.controlCommandAck
        this.regions.acceptResponse(sentAck, response.ackedControlSequence, sent.regionMeasurement)
        if (
          sentAck &&
          response.ackedControlSequence >= sentAck.sequence &&
          this.commandAck?.commandId === sentAck.commandId
        ) {
          this.commandAck = null
        }
        const acknowledgement = {
          ackedSessionTransitionSequence: response.ackedSessionTransitionSequence,
          sessionTransitionResults: response.sessionTransitionResults
        }
        if (sent.sessionTransitions.length === 0) {
          this.outbox.initializeCursor(acknowledgement)
        }
        const settled = this.outbox.acknowledge(acknowledgement)
        // Persist the global cursor before admitting sessions under this signed authority.
        this.authorityUntil = response.sessionAuthorityUntil
        for (const item of settled) {
          if (
            item.transition.transitionType === 'ACTIVATE' &&
            !item.activationEligible &&
            item.result.verdict === 'APPLIED' &&
            item.result.resultingStatus === 'ACTIVE'
          ) {
            this.outbox.enqueue({
              managedSessionId: item.transition.managedSessionId,
              runtimeSessionId: item.transition.runtimeSessionId,
              sessionBindingHash: item.transition.sessionBindingHash,
              transitionType: 'CLOSE',
              reason: 'TRANSPORT_CLOSED',
              expectedControlVersion: item.result.resultingControlVersion,
              occurredAt: Date.now()
            })
            this.options.presence.requestHeartbeat()
          }
        }
        for (const command of response.controlCommands) {
          if (
            command.commandType === 'SESSION_REVOKE' &&
            command.assignmentId === assignment.assignmentId
          ) {
            this.connections.revoke(command.managedSessionId)
          }
          // The Cloud cursor accepts exactly its next command, not a cumulative batch ACK.
          if (command.sequence === response.ackedControlSequence + 1) {
            if (command.commandType === 'SESSION_REVOKE') {
              this.commandAck = {
                sequence: command.sequence,
                commandId: command.commandId,
                acknowledgedResourceVersion: command.targetResourceVersion
              }
              this.options.presence.requestHeartbeat()
            } else {
              this.regions.acceptCommand(command, assignment)
            }
          }
        }
        if (response.regionMeasurementWindow) {
          this.regions.acceptWindow(response.regionMeasurementWindow, assignment)
        }
        this.connections.refreshAuthority()
        this.regions.afterResponse()
      } catch {
        this.failClosed()
      }
    }
  }
}
