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
  HiveRuntimeRelayControlCommandAck
} from './hive-runtime-relay-heartbeat-types'

type Options = {
  apiBaseUrl: string
  storageDirectory: string
  requestedRegion: string
  presence: HiveRuntimeCloudPresenceService
  getKeypair: () => E2EEKeypair | null
  attachRpc: (connection: RuntimeRpcAccountConnection) => () => void
  client?: HiveRuntimeRelayCloudClient
  createSocket?: HiveRuntimeRelaySocketFactory
}

/** Shared process composition; no account UI, paired device, or Desktop relay dependency. */
export class HiveRuntimeRelayHostService {
  private readonly broker: HiveRuntimeRelayBroker
  private readonly connections: HiveRuntimeRelayConnections
  private outbox: HiveRuntimeRelaySessionTransitionOutbox | null = null
  private outboxScope: string | null = null
  private assignment: HiveRuntimeRelayAssignment | null = null
  private authorityUntil: number | null = null
  private commandAck: HiveRuntimeRelayControlCommandAck | null = null
  private unsubscribe: (() => void) | null = null
  private failed = false

  constructor(private readonly options: Options) {
    const client = options.client ?? new HiveRuntimeRelayCloudClient(options.apiBaseUrl)
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
      isCurrent: (assignment) => this.isCurrent(assignment),
      getSessionAuthorityUntil: () => this.authorityUntil,
      requestHeartbeat: () => options.presence.requestHeartbeat(),
      onPersistenceFailure: () => this.failClosed(),
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
        this.connections.close()
        this.authorityUntil = null
        options.presence.requestHeartbeat()
      }
    })
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
          sessionTransitions: this.outbox.snapshot()
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
        // Authority is tied to the accepted signed heartbeat, never local traffic.
        this.authorityUntil = response.sessionAuthorityUntil
        const settled = this.outbox.acknowledge({
          ackedSessionTransitionSequence: response.ackedSessionTransitionSequence,
          sessionTransitionResults: response.sessionTransitionResults
        })
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
          if (command.assignmentId === assignment.assignmentId) {
            this.connections.revoke(command.managedSessionId)
          }
          // The Cloud cursor accepts exactly its next command, not a cumulative batch ACK.
          if (command.sequence === response.ackedControlSequence + 1) {
            this.commandAck = {
              sequence: command.sequence,
              commandId: command.commandId,
              acknowledgedResourceVersion: command.targetResourceVersion
            }
            this.options.presence.requestHeartbeat()
          }
        }
        this.connections.refreshAuthority()
      } catch {
        this.failClosed()
      }
    }
  }
}
