import {
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { getLocalizedExecutionHostLabel } from '@/lib/localized-execution-host-label'
import {
  getHostSettingOverride,
  getHostDisplayLabelOverrides
} from '../../../shared/host-setting-overrides'
import {
  applyConfirmedRuntimeDisplayName,
  resolveHiveRuntimeDisplayName
} from '../../../shared/hive-runtime-display-name'
import type { HiveAccountRuntimeDirectoryEntry } from '../../../shared/hive-runtime-cloud'
import type { PublicKnownRuntimeEnvironment } from '../../../shared/runtime-environments'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import {
  getExecutionHostIdForWorktree,
  getExplicitRuntimeEnvironmentIdForWorktree
} from '@/lib/worktree-runtime-owner'
import { selectRuntimeAwareSshTargetLabel } from '@/store/slices/runtime-environment-ssh-selectors'
import type { AppState } from '@/store/types'

type HostDisplayState = {
  settings: Pick<GlobalSettings, 'hostSettingOverrides'> | null
  runtimeEnvironments: readonly Pick<PublicKnownRuntimeEnvironment, 'id' | 'accountClaim'>[]
} & Partial<Pick<AppState, 'accountRuntimeDirectory' | 'localRuntimeOwnership'>>

export function selectLocalAccountRuntime(
  state: HostDisplayState
): HiveAccountRuntimeDirectoryEntry | null {
  const directory = state.accountRuntimeDirectory
  const ownership = state.localRuntimeOwnership
  if (
    !directory ||
    !ownership ||
    ownership.relation !== 'CLAIMED_BY_CURRENT' ||
    ownership.accountId !== directory.accountId ||
    ownership.sessionGeneration !== directory.sessionGeneration ||
    !ownership.runtimeRecordId
  ) {
    return null
  }
  const runtime = directory.items.find(
    (entry) => entry.runtimeRecordId === ownership.runtimeRecordId
  )
  return runtime && runtime.ownershipEpoch === ownership.ownershipEpoch
    ? applyConfirmedRuntimeDisplayName(
        runtime,
        directory.pendingDisplayNames?.find(
          (pending) => pending.runtimeRecordId === runtime.runtimeRecordId
        )
      )
    : null
}

export function selectExecutionHostDisplayLabels(
  state: HostDisplayState
): Map<ExecutionHostId, string> {
  const labels = new Map(getHostDisplayLabelOverrides(state.settings))
  for (const environment of state.runtimeEnvironments ?? []) {
    if (!environment.accountClaim) {
      continue
    }
    labels.set(
      toRuntimeExecutionHostId(environment.id),
      resolveHiveRuntimeDisplayName({
        runtimeRecordId: environment.accountClaim.runtimeRecordId,
        cloudDisplayName: environment.accountClaim.cloudDisplayName,
        reportedDeviceName: environment.accountClaim.reportedDeviceName
      })
    )
  }
  const local = selectLocalAccountRuntime(state)
  if (local) {
    labels.set(
      'local',
      resolveHiveRuntimeDisplayName({
        runtimeRecordId: local.runtimeRecordId,
        cloudDisplayName: local.cloudDisplayName,
        reportedDeviceName: local.deviceName
      })
    )
  }
  return labels
}

export function isAccountClaimedExecutionHost(
  state: HostDisplayState,
  hostId: ExecutionHostId
): boolean {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'local'
    ? selectLocalAccountRuntime(state) !== null
    : parsed?.kind === 'runtime' &&
        (state.runtimeEnvironments ?? []).some(
          (environment) =>
            environment.id === parsed.environmentId && environment.accountClaim != null
        )
}

// Claimed cloud names are shared; personal host labels remain local notes.
export function selectExecutionHostDisplayLabel(
  state: AppState,
  hostId: ExecutionHostId,
  // SSH labels are published per runtime environment when the target is reached through one.
  options: { sshEnvironmentId?: string | null } = {}
): string {
  const parsed = parseExecutionHostId(hostId)
  const local = parsed?.kind === 'local' ? selectLocalAccountRuntime(state) : null
  if (local) {
    return resolveHiveRuntimeDisplayName({
      runtimeRecordId: local.runtimeRecordId,
      cloudDisplayName: local.cloudDisplayName,
      reportedDeviceName: local.deviceName
    })
  }
  const environment =
    parsed?.kind === 'runtime'
      ? state.runtimeEnvironments?.find((entry) => entry.id === parsed.environmentId)
      : null
  if (environment?.accountClaim) {
    return resolveHiveRuntimeDisplayName({
      runtimeRecordId: environment.accountClaim.runtimeRecordId,
      cloudDisplayName: environment.accountClaim.cloudDisplayName,
      reportedDeviceName: environment.accountClaim.reportedDeviceName
    })
  }
  const override = getHostSettingOverride(state.settings, hostId, 'displayLabel')
  if (override) {
    return override
  }
  if (parsed?.kind === 'runtime') {
    const name = environment?.name.trim()
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
  return getLocalizedExecutionHostLabel(hostId)
}

/**
 * The machine a worktree's files live on, or null when ownership is still contested — the
 * `unresolved-owner` sentinel is routing bookkeeping and must never reach a reader as a host name.
 */
export function selectWorktreeHostDisplayLabel(state: AppState, worktreeId: string): string | null {
  const hostId = getExecutionHostIdForWorktree(state, worktreeId)
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'runtime' && parsed.environmentId === 'unresolved-owner') {
    return null
  }
  return selectExecutionHostDisplayLabel(state, hostId, {
    sshEnvironmentId:
      parsed?.kind === 'ssh' ? getExplicitRuntimeEnvironmentIdForWorktree(state, worktreeId) : null
  })
}
