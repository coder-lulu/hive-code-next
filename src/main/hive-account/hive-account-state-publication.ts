import type { HiveAccountState } from '../../shared/hive-account'

export function publishHiveAccountResult<T extends { state: HiveAccountState }>(
  onStateChanged: (state: HiveAccountState) => void,
  result: T
): T {
  try {
    onStateChanged(result.state)
  } catch {
    // Account mutations must not fail because a renderer window disappeared while broadcasting.
  }
  return result
}
