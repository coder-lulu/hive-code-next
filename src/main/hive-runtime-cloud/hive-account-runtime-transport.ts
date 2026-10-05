import WebSocket from 'ws'
import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import { HiveAccountRelayPool } from '../../shared/hive-account-relay-pool'
import type { HiveAccountRelaySocket } from '../../shared/hive-account-relay-channel'
import type {
  RuntimeOrchestrationEnvelope,
  RuntimeRpcResponse
} from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import type { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'
import { NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/protocol-version'
import { toHiveAccountRelayClientError } from '../../shared/hive-account-relay-errors'

const unavailable = () =>
  new RemoteRuntimeClientError('remote_runtime_unavailable', 'Account runtime is unavailable')
const createSocket = (url: string): HiveAccountRelaySocket =>
  new WebSocket(url, {
    perMessageDeflate: false,
    followRedirects: false,
    maxPayload: 8 * 1024 * 1024 + 82
  }) as unknown as HiveAccountRelaySocket

export class HiveAccountRuntimeTransport {
  private readonly pools = new Map<string, { version: number; pool: HiveAccountRelayPool }>()
  private scope: string | null = null
  private stopped = false
  private readonly unsubscribe: () => void
  private sequence = 0

  constructor(
    private readonly directory: Pick<
      HiveAccountRuntimeDirectoryService,
      'getState' | 'getConnectionScope' | 'createConnection' | 'subscribe'
    >,
    private readonly socketFactory: (url: string) => HiveAccountRelaySocket = createSocket
  ) {
    this.unsubscribe = directory.subscribe((state) => {
      const scope =
        state.accountId &&
        state.sessionGeneration !== null &&
        state.status !== 'SIGNED_OUT' &&
        state.errorCode !== 'SESSION_REJECTED'
          ? this.directory.getConnectionScope()
          : null
      if (scope !== this.scope) {
        this.closePools()
        this.scope = scope
      }
      if (state.status === 'READY') {
        for (const [id, entry] of this.pools) {
          const current = state.items.find((item) => item.runtimeRecordId === id)
          if (!current || current.resourceVersion !== entry.version) {
            this.disconnect(id)
          }
        }
      }
    })
  }

  async getStatus(
    claim: RuntimeEnvironmentAccountClaim,
    timeoutMs?: number
  ): Promise<RuntimeRpcResponse<RuntimeStatus>> {
    try {
      return await this.call(claim, 'status.get', {}, timeoutMs)
    } catch {
      const error = unavailable()
      return {
        id: 'status.get',
        ok: false,
        error: { code: error.code, message: error.message },
        _meta: { runtimeId: claim.runtimeRecordId }
      }
    }
  }

  async call<TResult>(
    claim: RuntimeEnvironmentAccountClaim,
    method: string,
    params: unknown,
    timeoutMs?: number,
    envelope?: RuntimeOrchestrationEnvelope,
    signal?: AbortSignal
  ): Promise<RuntimeRpcResponse<TResult>> {
    signal?.throwIfAborted()
    try {
      return (await this.pool(claim).request(
        method,
        params,
        timeoutMs,
        envelope,
        signal
      )) as RuntimeRpcResponse<TResult>
    } catch (error) {
      signal?.throwIfAborted()
      throw toHiveAccountRelayClientError(error)
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
    try {
      const subscription = await this.pool(claim).subscribe(method, params, callbacks, timeoutMs)
      return { requestId: `account-subscription-${++this.sequence}`, ...subscription }
    } catch (error) {
      throw toHiveAccountRelayClientError(error)
    }
  }

  disconnect(runtimeRecordId: string): void {
    this.pools.get(runtimeRecordId)?.pool.close()
    this.pools.delete(runtimeRecordId)
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.unsubscribe()
    this.closePools()
  }

  private pool(claim: RuntimeEnvironmentAccountClaim): HiveAccountRelayPool {
    if (this.stopped || !this.scope) {
      throw unavailable()
    }
    if (this.directory.getConnectionScope() !== this.scope) {
      this.closePools()
      throw unavailable()
    }
    const entry = this.pools.get(claim.runtimeRecordId)
    if (entry?.version === claim.resourceVersion) {
      return entry.pool
    }
    this.disconnect(claim.runtimeRecordId)
    if (this.pools.size >= 4) {
      throw unavailable()
    }
    const pool = new HiveAccountRelayPool({
      clientCapabilities: NATIVE_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
      createMaterial: () =>
        this.directory.createConnection(claim.runtimeRecordId, claim.resourceVersion),
      createSocket: this.socketFactory
    })
    this.pools.set(claim.runtimeRecordId, { version: claim.resourceVersion, pool })
    return pool
  }

  private closePools(): void {
    for (const entry of this.pools.values()) {
      entry.pool.close()
    }
    this.pools.clear()
  }
}
