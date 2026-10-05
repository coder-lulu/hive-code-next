import type { E2EEAuthenticatedCloudSession } from '../runtime/rpc/e2ee-channel'
import {
  parseRuntimeWebSessionDisplayMetadata,
  type RuntimeWebSessionDisplayMetadata
} from '../../shared/runtime-display-metadata'
import { HiveRuntimeCloudRequestError } from './hive-runtime-cloud-http-client'
import type { HiveRuntimeCloudClient } from './hive-runtime-cloud-client'
import type { HiveRuntimeCloudManagedSessionRegistry } from './hive-runtime-cloud-managed-session-registry'
import type { CurrentHiveRuntimeCloudLeaseContext } from './hive-runtime-cloud-lease-context'
import { createRuntimeWebSessionDisplayMetadataRequest } from './hive-runtime-cloud-web-session-control-proof'

export class HiveRuntimeDisplayMetadataError extends Error {
  constructor(
    readonly code: string,
    readonly retryAfterMs?: number
  ) {
    super('Runtime display metadata unavailable')
    this.name = 'HiveRuntimeDisplayMetadataError'
  }
}

type MetadataReadOptions = {
  principal: E2EEAuthenticatedCloudSession
  registry: HiveRuntimeCloudManagedSessionRegistry
  getContext: () => CurrentHiveRuntimeCloudLeaseContext | null
  client: Pick<HiveRuntimeCloudClient, 'readWebSessionDisplayMetadata'>
  now: () => number
  signal?: AbortSignal
}

export async function readManagedRuntimeDisplayMetadata(
  options: MetadataReadOptions
): Promise<RuntimeWebSessionDisplayMetadata> {
  const { principal, registry, getContext, client, now, signal } = options
  const context = getContext()
  const binding = context && registry.displayMetadataBinding(principal, context.tuple, now())
  if (!context || !binding) {
    throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
  }
  const current = (): boolean => {
    const next = getContext()
    return (
      next?.authorityId === context.authorityId &&
      registry.displayMetadataBinding(principal, next.tuple, now())?.principal === binding.principal
    )
  }
  try {
    const value = await client.readWebSessionDisplayMetadata(
      createRuntimeWebSessionDisplayMetadataRequest(
        context.identity,
        {
          ...binding.principal.currentTuple,
          managedWebSessionId: principal.managedWebSessionId,
          runtimeSessionId: principal.runtimeSessionId,
          expectedOwnershipEpoch: binding.ownershipEpoch
        },
        { authorityId: context.authorityId }
      ),
      signal
    )
    if (!current()) {
      throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
    }
    const result = parseRuntimeWebSessionDisplayMetadata(value)
    if (
      result.managedWebSessionId !== principal.managedWebSessionId ||
      result.runtimeSessionId !== principal.runtimeSessionId ||
      result.runtimeDisplayMetadata.runtimeRecordId !== context.tuple.runtimeRecordId ||
      result.runtimeDisplayMetadata.ownershipEpoch !== binding.ownershipEpoch ||
      result.controlVersion < binding.controlVersion
    ) {
      throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
    }
    return result
  } catch (error) {
    if (!current()) {
      throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
    }
    if (error instanceof HiveRuntimeDisplayMetadataError) {
      throw error
    }
    if (error instanceof HiveRuntimeCloudRequestError) {
      if (error.category === 'runtime_display_metadata_binding_invalid') {
        registry.revoke(principal)
        throw new HiveRuntimeDisplayMetadataError(error.category)
      }
      const code = [
        'runtime_display_metadata_proof_rejected',
        'runtime_display_metadata_request_invalid'
      ].includes(error.category ?? '')
        ? error.category!
        : 'runtime_display_metadata_unverifiable'
      throw new HiveRuntimeDisplayMetadataError(code, error.retryAfterMs ?? undefined)
    }
    throw new HiveRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
  }
}
