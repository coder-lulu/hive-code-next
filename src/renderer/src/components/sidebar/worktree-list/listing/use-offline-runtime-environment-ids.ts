import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getOfflineRuntimeEnvironmentIds } from '@/lib/runtime-offline-directory'

export function useOfflineRuntimeEnvironmentIds(): ReadonlySet<string> {
  const statuses = useAppStore((state) => state.runtimeStatusByEnvironmentId)
  const environments = useAppStore((state) => state.runtimeEnvironments)
  return useMemo(
    () =>
      getOfflineRuntimeEnvironmentIds(
        statuses,
        environments.map((environment) => environment.id)
      ),
    [statuses, environments]
  )
}
