import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useExecutionHostDisplayLabels } from '@/hooks/use-execution-host-display-labels'
import {
  buildSidebarHostOptions,
  buildSidebarHostScopeOptions,
  type SidebarHostOption,
  type SidebarHostScopeOption
} from './sidebar-host-options'

/** Share live host derivation between the scope strip and workspace options. */
export function useSidebarHostScopeOptions(): {
  hostOptions: SidebarHostOption[]
  hostScopeOptions: SidebarHostScopeOption[]
} {
  useTranslation()
  const repos = useAppStore((s) => s.repos)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const settings = useAppStore((s) => s.settings)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const wslHostStatuses = useAppStore((s) => s.wslHostStatuses)
  const wslHostServerFilesMissing = useAppStore((s) => s.wslHostServerFiles === 'missing')

  const hostLabelOverrides = useExecutionHostDisplayLabels()
  const hostOptions = buildSidebarHostOptions({
    repos,
    sshTargetLabels,
    sshConnectionStates,
    settings,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    hostLabelOverrides,
    wslHostStatuses,
    wslHostsEnabled: true,
    wslHostServerFilesMissing
  })
  const hostScopeOptions = useMemo(() => buildSidebarHostScopeOptions(hostOptions), [hostOptions])

  return { hostOptions, hostScopeOptions }
}
