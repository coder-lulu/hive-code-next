import {
  getExecutionHostLabel,
  isUnresolvedOwnerHostId,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import {
  getHostSettingOverride,
  getHostDisplayLabelOverrides
} from '../../../shared/host-setting-overrides'
import {
  applyConfirmedRuntimeDisplayName,
  resolveHiveRuntimeDisplayName
} from '../../../shared/hive-runtime-display-name'
import type { HiveAccountRuntimeDirectoryEntry } from '../../../shared/hive-runtime-cloud'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { runtimeEnvironmentIdUnlessTwin } from '@/lib/resolve-owner'
import { selectRuntimeAwareSshTargetLabel } from '@/store/slices/runtime-environment-ssh-selectors'
import type { AppState } from '@/store/types'

/** Prefer the user rename, then published machine/SSH label, then raw host ID. */
export function selectExecutionHostDisplayLabel(
  state: AppState,
  hostId: ExecutionHostId,
  // SSH labels are published per runtime environment when the target is reached through one.
  options: { sshEnvironmentId?: string | null } = {}
): string {
  const override = getHostSettingOverride(state.settings, hostId, 'displayLabel')
  if (override) {
    return override
  }
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'runtime') {
    const name = state.runtimeEnvironments
      ?.find((environment) => environment.id === parsed.environmentId)
      ?.name.trim()
    if (name) {
      return name
    }
  }
  if (parsed?.kind === 'ssh') {
    return selectRuntimeAwareSshTargetLabel(
      state,
      options.sshEnvironmentId ?? null,
      parsed.targetId
    )
  }
  return getExecutionHostLabel(hostId)
}

type HostDisplayState = {
  settings: Pick<GlobalSettings, 'hostSettingOverrides'> | null
  runtimeEnvironments: readonly Pick<PublicKnownRuntimeEnvironment, 'id' | 'accountClaim'>[]
} & Partial<Pick<AppState, 'accountRuntimeDirectory' | 'localRuntimeOwnership'>>

export function selectLocalAccountRuntime(state: HostDisplayState): HiveAccountRuntimeDirectoryEntry | null {
  const directory = state.accountRuntimeDirectory
  const ownership = state.localRuntimeOwnership
  if (!directory || !ownership || ownership.relation !== 'CLAIMED_BY_CURRENT' || ownership.accountId !== directory.accountId || ownership.sessionGeneration !== directory.sessionGeneration || !ownership.runtimeRecordId) return null
  const runtime = directory.items.find((entry) => entry.runtimeRecordId === ownership.runtimeRecordId)
  return runtime && runtime.ownershipEpoch === ownership.ownershipEpoch
    ? applyConfirmedRuntimeDisplayName(runtime, directory.pendingDisplayNames?.find((pending) => pending.runtimeRecordId === runtime.runtimeRecordId))
    : null
}

export function selectExecutionHostDisplayLabels(state: HostDisplayState): Map<ExecutionHostId, string> {
  const labels = new Map(getHostDisplayLabelOverrides(state.settings))
  for (const environment of state.runtimeEnvironments ?? []) {
    if (!environment.accountClaim) continue
    labels.set(toRuntimeExecutionHostId(environment.id), resolveHiveRuntimeDisplayName({
      runtimeRecordId: environment.accountClaim.runtimeRecordId,
      cloudDisplayName: environment.accountClaim.cloudDisplayName,
      reportedDeviceName: environment.accountClaim.reportedDeviceName
    }))
  }
  const local = selectLocalAccountRuntime(state)
  if (local) labels.set('local', resolveHiveRuntimeDisplayName({ runtimeRecordId: local.runtimeRecordId, cloudDisplayName: local.cloudDisplayName, reportedDeviceName: local.deviceName }))
  return labels
}

export function isAccountClaimedExecutionHost(state: HostDisplayState, hostId: ExecutionHostId): boolean {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'local' ? selectLocalAccountRuntime(state) !== null : parsed?.kind === 'runtime' && (state.runtimeEnvironments ?? []).some((environment) => environment.id === parsed.environmentId && environment.accountClaim != null)
}
/** Return null for contested ownership; unresolved-owner is routing bookkeeping, never a user-visible machine name. */
export function selectWorktreeHostDisplayLabel(state: AppState, worktreeId: string): string | null {
  const hostId = getExecutionHostIdForWorktree(state, worktreeId)
  if (isUnresolvedOwnerHostId(hostId)) {
    return null
  }
  const parsed = parseExecutionHostId(hostId)
  return selectExecutionHostDisplayLabel(state, hostId, {
    // Why: a label only reads; a twin names the direct SSH target.
    sshEnvironmentId:
      parsed?.kind === 'ssh' ? runtimeEnvironmentIdUnlessTwin(state, worktreeId) : null
  })
}
