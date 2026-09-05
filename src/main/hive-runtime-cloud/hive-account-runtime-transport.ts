import type { RemoteRuntimeSubscription } from '../../shared/remote-runtime-client'
import { RemoteRuntimeClientError } from '../../shared/remote-runtime-client-error'
import type {
  RuntimeOrchestrationEnvelope,
  RuntimeRpcResponse
} from '../../shared/runtime-rpc-envelope'
import type { RuntimeStatus } from '../../shared/runtime-types'
import type { RuntimeEnvironmentAccountClaim } from '../../shared/runtime-environments'
import type { HiveAccountRuntimeDirectoryService } from './hive-account-runtime-directory-service'

function unavailable(): RemoteRuntimeClientError {
  return new RemoteRuntimeClientError(
    'remote_runtime_unavailable',
    'Account remote connection is not ready.'
  )
}

export class HiveAccountRuntimeTransport {
  constructor(
    _directory: Pick<
      HiveAccountRuntimeDirectoryService,
      'getState' | 'createConnection' | 'subscribe'
    >
  ) {}

  async getStatus(
    claim: RuntimeEnvironmentAccountClaim,
    _timeoutMs?: number
  ): Promise<RuntimeRpcResponse<RuntimeStatus>> {
    const error = unavailable()
    return {
      id: 'status.get',
      ok: false,
      error: { code: error.code, message: error.message },
      _meta: { runtimeId: claim.runtimeRecordId }
    }
  }

  async call<TResult>(
    _claim: RuntimeEnvironmentAccountClaim,
    _method: string,
    _params: unknown,
    _timeoutMs?: number,
    _envelope?: RuntimeOrchestrationEnvelope
  ): Promise<RuntimeRpcResponse<TResult>> {
    throw unavailable()
  }

  async subscribe(
    _claim: RuntimeEnvironmentAccountClaim,
    _method: string,
    _params: unknown,
    _timeoutMs: number | undefined,
    _callbacks: {
      onResponse: (response: RuntimeRpcResponse<unknown>) => void
      onBinary?: (bytes: Uint8Array<ArrayBufferLike>) => void
      onError: (error: { code: string; message: string }) => void
      onClose: () => void
    }
  ): Promise<RemoteRuntimeSubscription> {
    throw unavailable()
  }

  disconnect(_runtimeRecordId: string): void {}

  stop(): void {}
}
