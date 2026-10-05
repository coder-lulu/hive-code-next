import { useMemo, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PublicKnownRuntimeEnvironment } from '../../../../shared/runtime-environments'
import { projectHiveRuntimeAccountClaim } from '../../../../shared/hive-runtime-cloud'
import { resolveHiveRuntimeDisplayName } from '../../../../shared/hive-runtime-display-name'
import { useAppStore } from '@/store'
import { selectLocalAccountRuntime } from '@/lib/execution-host-display-label'
import { resolveRuntimeCloudRenameEnvironment } from './runtime-environment-host-details-account'

export function useRuntimeCloudAliasSettings(
  settings: GlobalSettings,
  environments: PublicKnownRuntimeEnvironment[]
) {
  const directory = useAppStore((state) => state.accountRuntimeDirectory)
  const ownership = useAppStore((state) => state.localRuntimeOwnership)
  const [selected, setSelected] = useState<{ id: string; scope: string } | null>(null)
  const scope =
    directory.accountId && directory.sessionGeneration != null
      ? `${directory.accountId}\u0000${directory.sessionGeneration}`
      : null
  const localEnvironment = useMemo((): PublicKnownRuntimeEnvironment | null => {
    const runtime = selectLocalAccountRuntime({
      settings,
      runtimeEnvironments: environments,
      accountRuntimeDirectory: directory,
      localRuntimeOwnership: ownership
    })
    if (!runtime) {
      return null
    }
    return {
      id: 'local',
      name: resolveHiveRuntimeDisplayName({
        runtimeRecordId: runtime.runtimeRecordId,
        cloudDisplayName: runtime.cloudDisplayName,
        reportedDeviceName: runtime.deviceName
      }),
      runtimeRecordId: runtime.runtimeRecordId,
      runtimeId: null,
      createdAt: runtime.createdAt,
      updatedAt: runtime.updatedAt,
      lastUsedAt: null,
      endpoints: [],
      preferredEndpointId: 'local',
      accountClaim: projectHiveRuntimeAccountClaim(runtime)
    }
  }, [directory, environments, ownership, settings])
  const targets = localEnvironment ? [...environments, localEnvironment] : environments
  return {
    canRename: scope !== null,
    localEnvironment,
    environment: resolveRuntimeCloudRenameEnvironment(
      targets,
      selected?.id ?? null,
      selected?.scope ?? null,
      scope
    ),
    open: (environment: PublicKnownRuntimeEnvironment) => {
      if (scope && environment.accountClaim) {
        setSelected({ id: environment.id, scope })
      }
    },
    close: () => setSelected(null)
  }
}
