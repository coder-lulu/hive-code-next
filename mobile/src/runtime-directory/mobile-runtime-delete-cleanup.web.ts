import type { CapturedRuntimeDeleteAlias } from './mobile-runtime-delete-recovery'
export function runtimeDeletionSupportedOnThisSurface(): boolean {
  return false
}

export async function clearUnlinkedRuntimeConnections(
  _runtimeRecordId: string,
  _forgetHostClient: (hostId: string) => void,
  _isCurrent: () => boolean,
  _capturedAliases?: readonly CapturedRuntimeDeleteAlias[]
): Promise<void> {
  throw new Error('runtime_deletion_requires_native_app')
}
