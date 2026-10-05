import { parseRuntimeWebSessionDisplayMetadata } from '../../../shared/runtime-display-metadata'
import {
  isWebAccountRuntimeBindingError,
  webAccountRetryAfterMs
} from './account-runtime-relay/web-account-session'
import {
  getClientForEnvironment,
  isCurrentWebRuntimeDisplayOwner,
  mergeWebRuntimeDisplayMetadata,
  WebRuntimeDisplayMetadataError,
  webRuntimeState,
  type WebRuntimeDisplayOwner
} from './preload-api/web-runtime-session'

export async function refreshWebRuntimeDisplayMetadata(
  owner: WebRuntimeDisplayOwner,
  signal: AbortSignal
): Promise<void> {
  if (!isCurrentWebRuntimeDisplayOwner(owner) || signal.aborted) {
    return
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
  }
  if (owner.account) {
    let runtime
    try {
      runtime = await owner.account.session.runtime(owner.runtimeRecordId, signal)
    } catch (error) {
      if (!isCurrentWebRuntimeDisplayOwner(owner) || signal.aborted) {
        return
      }
      if (isWebAccountRuntimeBindingError(error)) {
        throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
      }
      throw error
    }
    if (!isCurrentWebRuntimeDisplayOwner(owner) || signal.aborted) {
      return
    }
    if (runtime.status !== 'CLAIMED') {
      throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_binding_invalid')
    }
    await mergeWebRuntimeDisplayMetadata(owner, {
      runtimeRecordId: runtime.runtimeRecordId,
      resourceVersion: runtime.resourceVersion,
      ownershipEpoch: runtime.ownershipEpoch,
      cloudDisplayName: runtime.cloudDisplayName,
      cloudDisplayNameVersion: runtime.cloudDisplayNameVersion,
      deviceName: runtime.deviceName ?? null
    })
    return
  }
  const response = await getClientForEnvironment(webRuntimeState.activeEnvironment!).call(
    'cloudRuntime.displayMetadata',
    {},
    { timeoutMs: 15_000, signal }
  )
  if (!isCurrentWebRuntimeDisplayOwner(owner) || signal.aborted) {
    return
  }
  if (!response.ok) {
    const data = response.error.data
    const retryAfterMs =
      data && typeof data === 'object' && 'retryAfterMs' in data ? data.retryAfterMs : undefined
    const retry =
      typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0
        ? Math.min(retryAfterMs, 2_147_483_647)
        : undefined
    throw new WebRuntimeDisplayMetadataError(response.error.code, retry)
  }
  const result = parseRuntimeWebSessionDisplayMetadata(response.result)
  if (
    result.managedWebSessionId !== owner.cloud!.managedWebSessionId ||
    result.runtimeSessionId !== owner.cloud!.runtimeSessionId
  ) {
    throw new WebRuntimeDisplayMetadataError('runtime_display_metadata_unverifiable')
  }
  await mergeWebRuntimeDisplayMetadata(owner, result.runtimeDisplayMetadata)
}

export function metadataRetryAfterMs(error: unknown): number | undefined {
  return error instanceof WebRuntimeDisplayMetadataError
    ? error.retryAfterMs
    : webAccountRetryAfterMs(error)
}
