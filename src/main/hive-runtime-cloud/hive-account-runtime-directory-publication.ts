import type { HiveAccountRuntimeDirectoryState } from '../../shared/hive-runtime-cloud'

export function publishHiveAccountRuntimeDirectory(
  listeners: ReadonlySet<(state: HiveAccountRuntimeDirectoryState) => void>,
  state: HiveAccountRuntimeDirectoryState
): void {
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      // Observers cannot roll back a completed directory transition.
    }
  }
}
