/** Kept as the shared availability hook for existing main/preload callers.
 * Hive exposes WSL hosts by default; platform, installed resources, and authorization
 * are verified by the capability and host-operation handlers.
 */
export const WSL_HOSTS_INTERNAL_GATE_ENV = 'ORCA_INTERNAL_WSL_HOSTS'

export function isWslHostsInternalGateOpen(
  _env: Readonly<Record<string, string | undefined>>
): boolean {
  return true
}
