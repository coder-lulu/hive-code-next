import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type {
  RuntimeOrchestrationEnvelope,
  RuntimeRpcResponse
} from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import { assertHiveAccountRuntimeCloudConnectable } from './hive-account-runtime-connection-material'
import type { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'
import {
  evictHiveAccountRuntimeRequestConnections,
  hiveAccountRuntimeDirectoryAuthorizationKey,
  isHiveAccountRuntimeClaimCurrent,
  touchHiveAccountRuntimeRequestConnection
} from './hive-account-runtime-request-connection-cache'
import { isHiveAccountRuntimeCloudConnectable } from './hive-runtime-catalog'
import {
  accountRuntimeStatusFailure,
  defaultAccountRuntimeTransportDependencies,
  HIVE_ACCOUNT_RUNTIME_DEFAULT_TIMEOUT_MS,
  type AccountRelayConnection,
  type AccountRuntimeSubscriptionConnection,
  type AccountRuntimeTransportDependencies,
  type CachedAccountRuntimeConnection
} from './hive-account-runtime-transport-support'

export class HiveAccountRuntimeTransport {
  private readonly requestConnections = new Map<string, CachedAccountRuntimeConnection>()
  private readonly subscriptionConnections = new Map<
    AccountRelayConnection,
    AccountRuntimeSubscriptionConnection
  >()
  private readonly unsubscribeDirectory: () => void
  private directoryAuthorizationKey: string | null = null
  private stopped = false

  constructor(
    private readonly directory: Pick<
      HiveAccountRuntimeDirectoryService,
      'getState' | 'createConnection' | 'subscribe'
    >,
    private readonly dependencies: AccountRuntimeTransportDependencies = defaultAccountRuntimeTransportDependencies
  ) {
    this.unsubscribeDirectory = directory.subscribe((state) => {
      const authorizationKey = hiveAccountRuntimeDirectoryAuthorizationKey(state)
      const authorizationChanged =
        this.directoryAuthorizationKey !== null &&
        this.directoryAuthorizationKey !== authorizationKey
      this.directoryAuthorizationKey = authorizationKey
      if (authorizationChanged) {
        this.closeAll()
      }
      if (state.status === 'SIGNED_OUT' || state.status === 'DISABLED') {
        this.closeAll()
        return
      }
      const revisions = new Map(
        state.items
          .filter(isHiveAccountRuntimeCloudConnectable)
          .map((entry) => [entry.runtimeRecordId, entry.resourceVersion] as const)
      )
      for (const [runtimeRecordId, cached] of this.requestConnections) {
        if (revisions.get(runtimeRecordId) !== cached.resourceVersion) {
          this.requestConnections.delete(runtimeRecordId)
          cached.connection?.close()
        }
      }
      for (const [connection, subscription] of this.subscriptionConnections) {
        if (revisions.get(subscription.runtimeRecordId) !== subscription.resourceVersion) {
          this.subscriptionConnections.delete(connection)
          connection.close()
        }
      }
    })
  }

  async getStatus(
    claim: RuntimeEnvironmentAccountClaim,
    timeoutMs = HIVE_ACCOUNT_RUNTIME_DEFAULT_TIMEOUT_MS
  ): Promise<RuntimeRpcResponse<RuntimeStatus>> {
    try {
      return await this.call<RuntimeStatus>(claim, 'status.get', undefined, timeoutMs)
    } catch (error) {
      return accountRuntimeStatusFailure(claim, error)
    }
  }

  async call<TResult>(
    claim: RuntimeEnvironmentAccountClaim,
    method: string,
    params: unknown,
    timeoutMs = HIVE_ACCOUNT_RUNTIME_DEFAULT_TIMEOUT_MS,
    envelope?: RuntimeOrchestrationEnvelope
  ): Promise<RuntimeRpcResponse<TResult>> {
    assertHiveAccountRuntimeCloudConnectable(claim)
    const connection = await this.getRequestConnection(claim, timeoutMs)
    try {
      return await connection.request<TResult>(method, params, timeoutMs, envelope)
    } catch (error) {
      if (
        !(error instanceof RemoteRuntimeClientError) ||
        (error.code !== 'invalid_argument' && error.code !== 'remote_runtime_busy')
      ) {
        this.retireRequestConnection(claim.runtimeRecordId, connection)
      }
      throw error
    }
  }

  async subscribe(
    claim: RuntimeEnvironmentAccountClaim,
    method: string,
    params: unknown,
    timeoutMs: number | undefined,
    callbacks: {
      onResponse: (response: RuntimeRpcResponse<unknown>) => void
      onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
      onError: (error: { code: string; message: string }) => void
      onClose: () => void
    }
  ): Promise<RemoteRuntimeSubscription> {
    assertHiveAccountRuntimeCloudConnectable(claim)
    const material = await this.directory.createConnection(
      claim.runtimeRecordId,
      claim.resourceVersion
    )
    if (this.stopped || !isHiveAccountRuntimeClaimCurrent(this.directory.getState(), claim)) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Cloud Runtime authorization changed while connecting.'
      )
    }
    const connection = this.dependencies.createRelayConnection(material)
    this.subscriptionConnections.set(connection, {
      runtimeRecordId: claim.runtimeRecordId,
      resourceVersion: claim.resourceVersion
    })
    try {
      await connection.connect(timeoutMs ?? HIVE_ACCOUNT_RUNTIME_DEFAULT_TIMEOUT_MS)
      if (
        this.stopped ||
        !this.subscriptionConnections.has(connection) ||
        !isHiveAccountRuntimeClaimCurrent(this.directory.getState(), claim)
      ) {
        throw new RemoteRuntimeClientError(
          'remote_runtime_unavailable',
          'Cloud Runtime authorization changed while connecting.'
        )
      }
      let closed = false
      const retire = (): void => {
        if (closed) {
          return
        }
        closed = true
        this.subscriptionConnections.delete(connection)
      }
      const subscription = connection.subscribe(method, params, {
        onResponse: callbacks.onResponse,
        onBinary: callbacks.onBinary,
        onError: (error) => {
          retire()
          callbacks.onError({ code: error.code, message: error.message })
        },
        onClose: () => {
          retire()
          callbacks.onClose()
        }
      })
      return {
        ...subscription,
        close: () => {
          retire()
          subscription.close()
        }
      }
    } catch (error) {
      this.subscriptionConnections.delete(connection)
      connection.close()
      throw error
    }
  }

  disconnect(runtimeRecordId: string): void {
    const cached = this.requestConnections.get(runtimeRecordId)
    this.requestConnections.delete(runtimeRecordId)
    cached?.connection?.close()
    for (const [connection, subscription] of this.subscriptionConnections) {
      if (subscription.runtimeRecordId === runtimeRecordId) {
        this.subscriptionConnections.delete(connection)
        connection.close()
      }
    }
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.unsubscribeDirectory()
    this.closeAll()
  }

  private async getRequestConnection(
    claim: RuntimeEnvironmentAccountClaim,
    timeoutMs: number
  ): Promise<AccountRelayConnection> {
    if (this.stopped) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Cloud Runtime transport stopped.'
      )
    }
    const existing = this.requestConnections.get(claim.runtimeRecordId)
    if (existing?.resourceVersion === claim.resourceVersion) {
      touchHiveAccountRuntimeRequestConnection(
        this.requestConnections,
        claim.runtimeRecordId,
        existing
      )
      return existing.ready
    }
    existing?.connection?.close()
    if (existing) {
      this.requestConnections.delete(claim.runtimeRecordId)
    }
    evictHiveAccountRuntimeRequestConnections(
      this.requestConnections,
      this.dependencies.maxCachedRequestConnections
    )
    const cached: CachedAccountRuntimeConnection = {
      resourceVersion: claim.resourceVersion,
      connection: null,
      ready: Promise.resolve(null as never)
    }
    cached.ready = this.openRequestConnection(claim, timeoutMs, cached)
    this.requestConnections.set(claim.runtimeRecordId, cached)
    try {
      return await cached.ready
    } catch (error) {
      if (this.requestConnections.get(claim.runtimeRecordId) === cached) {
        this.requestConnections.delete(claim.runtimeRecordId)
        cached.connection?.close()
      }
      throw error
    }
  }

  private retireRequestConnection(
    runtimeRecordId: string,
    connection: AccountRelayConnection
  ): void {
    if (this.requestConnections.get(runtimeRecordId)?.connection !== connection) {
      return
    }
    this.requestConnections.delete(runtimeRecordId)
    connection.close()
  }

  private async openRequestConnection(
    claim: RuntimeEnvironmentAccountClaim,
    timeoutMs: number,
    cached: CachedAccountRuntimeConnection
  ): Promise<AccountRelayConnection> {
    const material = await this.directory.createConnection(
      claim.runtimeRecordId,
      claim.resourceVersion
    )
    if (
      this.stopped ||
      this.requestConnections.get(claim.runtimeRecordId) !== cached ||
      !isHiveAccountRuntimeClaimCurrent(this.directory.getState(), claim)
    ) {
      throw new RemoteRuntimeClientError(
        'remote_runtime_unavailable',
        'Cloud Runtime authorization changed while connecting.'
      )
    }
    const connection = this.dependencies.createRelayConnection(material)
    cached.connection = connection
    try {
      await connection.connect(timeoutMs)
      if (this.stopped || this.requestConnections.get(claim.runtimeRecordId) !== cached) {
        connection.close()
        throw new RemoteRuntimeClientError(
          'remote_runtime_unavailable',
          'Cloud Runtime connection was retired while connecting.'
        )
      }
      return connection
    } catch (error) {
      this.retireRequestConnection(claim.runtimeRecordId, connection)
      throw error
    }
  }

  private closeAll(): void {
    for (const cached of this.requestConnections.values()) {
      cached.connection?.close()
    }
    this.requestConnections.clear()
    for (const connection of this.subscriptionConnections.keys()) {
      connection.close()
    }
    this.subscriptionConnections.clear()
  }
}
