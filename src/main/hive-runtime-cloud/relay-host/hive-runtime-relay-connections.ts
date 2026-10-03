import type { E2EEKeypair } from '../../runtime/e2ee-keypair'
import { E2EEChannel } from '../../runtime/rpc/e2ee-channel'
import type { RuntimeRpcAccountConnection } from '../../runtime/runtime-rpc/runtime-rpc-account-dispatch'
import { HiveRuntimeRelayAccountSession } from './hive-runtime-relay-account-session'
import { HiveRuntimeRelayDataTransport } from './hive-runtime-relay-data-transport'
import type { HiveRuntimeRelayAssignment } from './hive-runtime-relay-types'
import type { HiveRuntimeRelayCloudClient } from './hive-runtime-relay-cloud-client'
import type { HiveRuntimeRelaySessionTransitionOutbox } from './hive-runtime-relay-session-transition-outbox'
import type { ConnectionOpen } from './hive-runtime-relay-protocol'
import { HIVE_RELAY_CLOSE, type HiveRuntimeRelaySocketFactory } from './hive-runtime-relay-socket'

type Options = {
  client: Pick<HiveRuntimeRelayCloudClient, 'consume'>
  getKeypair: () => E2EEKeypair | null
  getOutbox: () => HiveRuntimeRelaySessionTransitionOutbox | null
  isCurrent: (assignment: HiveRuntimeRelayAssignment) => boolean
  getSessionAuthorityUntil: () => number | null
  requestHeartbeat: () => void
  onPersistenceFailure: () => void
  onIdle?: () => void
  canAccept?: () => boolean
  attachRpc: (connection: RuntimeRpcAccountConnection) => () => void
  createSocket?: HiveRuntimeRelaySocketFactory
}
type Entry = { session: HiveRuntimeRelayAccountSession; close: () => void }

export class HiveRuntimeRelayConnections {
  private readonly entries = new Map<string, Entry>()
  private readonly seen = new Set<string>()
  constructor(private readonly options: Options) {}

  get count(): number {
    return this.entries.size
  }

  open(assignment: HiveRuntimeRelayAssignment, connection: ConnectionOpen): void {
    const keypair = this.options.getKeypair()
    const outbox = this.options.getOutbox()
    if (
      !keypair ||
      !outbox?.canAccept ||
      this.options.canAccept?.() === false ||
      this.entries.size >= 32 ||
      this.seen.has(connection.connId) ||
      !this.options.isCurrent(assignment)
    ) {
      return
    }
    this.seen.add(connection.connId)
    if (this.seen.size > 512) {
      this.seen.delete(this.seen.values().next().value!)
    }
    let channel: E2EEChannel | null = null
    let detach: (() => void) | null = null
    let closed = false
    const cleanup = () => {
      if (closed) {
        return
      }
      closed = true
      this.entries.delete(connection.connId)
      try {
        try {
          channel?.destroy()
        } finally {
          detach?.()
        }
      } finally {
        try {
          session.close('TRANSPORT_CLOSED')
        } finally {
          transport.close()
          if (this.entries.size === 0) {
            this.options.onIdle?.()
          }
        }
      }
    }
    const session = new HiveRuntimeRelayAccountSession({
      assignment,
      connection,
      client: this.options.client,
      outbox,
      isCurrent: () => !closed && this.options.isCurrent(assignment),
      getSessionAuthorityUntil: this.options.getSessionAuthorityUntil,
      requestHeartbeat: this.options.requestHeartbeat,
      onClose: () => transport.close(HIVE_RELAY_CLOSE.AUTH_REQUIRED),
      onPersistenceFailure: this.options.onPersistenceFailure
    })
    const transport = new HiveRuntimeRelayDataTransport({
      assignment,
      connection,
      createSocket: this.options.createSocket,
      isCurrent: () => !closed && this.options.isCurrent(assignment),
      onClose: cleanup,
      onMessage: (raw) => channel?.handleRawMessage(raw),
      onReady: (ws) => {
        channel = new E2EEChannel(ws, {
          serverSecretKey: keypair.secretKey,
          transportContext: { transport: 'relay', relayHostId: assignment.relayHostId },
          resolveAuthenticatedDevice: () => null,
          onReady: cleanup,
          resolveAccountSession: (auth, signal, binding) =>
            session.authenticate(auth, signal, binding),
          onAccountReady: (ready, principal) => {
            if (closed || !session.revalidate() || !session.operationCallerKey) {
              cleanup()
              return
            }
            detach = this.options.attachRpc({
              ws,
              channel: ready,
              connectionId: `hive-relay:${connection.connId}`,
              runtimeSessionId: principal.runtimeSessionId,
              operationCallerKey: session.operationCallerKey,
              revalidate: (touch) => session.revalidate(touch)
            })
          },
          onError: (code) =>
            transport.close(
              code === 4002 ? HIVE_RELAY_CLOSE.AUTH_TIMEOUT : HIVE_RELAY_CLOSE.AUTH_REQUIRED
            )
        })
      }
    })
    this.entries.set(connection.connId, { session, close: cleanup })
    transport.connect()
  }

  revoke(managedSessionId: string): void {
    for (const { session } of this.entries.values()) {
      if (session.managedSessionId === managedSessionId) {
        session.revoke()
      }
    }
  }

  refreshAuthority(): void {
    for (const { session } of this.entries.values()) {
      session.refreshAuthority()
    }
  }

  close(): void {
    let firstError: unknown
    const entries = [...this.entries.values()]
    for (const entry of entries) {
      try {
        entry.close()
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) {
      throw firstError
    }
  }
}
