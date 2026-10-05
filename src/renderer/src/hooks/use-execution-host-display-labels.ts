import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { selectExecutionHostDisplayLabels } from '@/lib/execution-host-display-label'

export function useExecutionHostDisplayLabels() {
  const settings = useAppStore((state) => state.settings)
  const runtimeEnvironments = useAppStore((state) => state.runtimeEnvironments)
  const accountRuntimeDirectory = useAppStore((state) => state.accountRuntimeDirectory)
  const localRuntimeOwnership = useAppStore((state) => state.localRuntimeOwnership)
  return useMemo(
    () =>
      selectExecutionHostDisplayLabels({
        settings,
        runtimeEnvironments,
        accountRuntimeDirectory,
        localRuntimeOwnership
      }),
    [settings, runtimeEnvironments, accountRuntimeDirectory, localRuntimeOwnership]
  )
}
