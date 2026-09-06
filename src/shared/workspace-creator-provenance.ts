import type { WorkspaceCreatorProvenance } from './worktree/types'

export function normalizeWorkspaceCreatorProvenance(
  value: unknown
): WorkspaceCreatorProvenance | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const candidate = value as { kind?: unknown; deviceId?: unknown; runtimeSessionId?: unknown }
  if (
    candidate.kind === 'account-runtime' &&
    typeof candidate.runtimeSessionId === 'string' &&
    candidate.runtimeSessionId.trim()
  ) {
    return { kind: 'account-runtime', runtimeSessionId: candidate.runtimeSessionId }
  }
  if (candidate.kind === 'host') {
    return { kind: 'host' }
  }
  if (
    candidate.kind === 'paired-device' &&
    typeof candidate.deviceId === 'string' &&
    candidate.deviceId.trim().length > 0
  ) {
    return { kind: 'paired-device', deviceId: candidate.deviceId }
  }
  return undefined
}
