import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'
import { getLocalizedLocalExecutionHostLabel } from '@/lib/localized-execution-host-label'
import { useExecutionHostDisplayLabels } from '@/hooks/use-execution-host-display-labels'
import type { Repo } from '../../../../shared/repo-types'
import { getAutomationTargetAvailability } from './automation-target-availability'
import type { AutomationSourceAvailability } from './use-automation-source-availability'
import type { AutomationsPageDestinationState } from './use-automations-page-destination-state'
import type { AutomationsPageDestinationFormState } from './use-automations-page-destination-form'
import type { AutomationsPageListState } from './use-automations-page-list-state'
import type { AutomationsPageLocalState } from './use-automations-page-local-state'
import type { AutomationsPageStoreState } from './use-automations-page-store-state'

/** Display labels and action availability derived from the selected host row. */
export function useAutomationsPagePresentationState({
  store,
  local,
  list,
  destination,
  destinationForm,
  sourceAvailability
}: {
  store: AutomationsPageStoreState
  local: AutomationsPageLocalState
  list: AutomationsPageListState
  destination: AutomationsPageDestinationState
  destinationForm: AutomationsPageDestinationFormState
  sourceAvailability: AutomationSourceAvailability
}) {
  const { i18n } = useTranslation()
  const {
    projectHostSetups,
    sshConnectionStates,
    runtimeStatusByEnvironmentId,
    sshTargetLabels,
    runtimeEnvironments,
    repoForRow,
    worktreeForRow
  } = store
  const { editingAutomationId, draftAtOpen, draft, activePaneTab, setActivePaneTab } = local
  const { selected, selectedRow } = list
  const { automationHostTargetFor } = destination
  const { automationSourceHostAvailabilityByRowKey } = sourceAvailability
  const selectedRepo = selectedRow ? (repoForRow(selectedRow) ?? null) : null
  const selectedWorktree =
    selectedRow && selected?.workspaceId
      ? (worktreeForRow(selectedRow, selectedRepo ?? undefined) ?? null)
      : null
  const selectedRunNowAvailability = selectedRow
    ? getAutomationTargetAvailability({
        automation: selectedRow.automation,
        repo: selectedRepo,
        workspace: selectedWorktree,
        projectHostSetups,
        sshConnectionStates,
        runtimeStatusByEnvironmentId,
        automationHostTarget: automationHostTargetFor(selectedRow),
        sourceHostAvailability: automationSourceHostAvailabilityByRowKey.get(selectedRow.key)
      })
    : null
  const canSaveDraft =
    editingAutomationId === null ||
    !draftAtOpen ||
    JSON.stringify(draft) !== JSON.stringify(draftAtOpen) ||
    (editingAutomationId !== null &&
      local.editingHostStableKey !== destination.rowRecoveryHost(local.editingRowKey)?.stableKey)
  const hostLabelOverrides = useExecutionHostDisplayLabels()
  const getAutomationRepoHostLabel = useCallback(
    (repo: Repo): string => {
      const hostId = getRepoExecutionHostId(repo)
      const cloudLabel = hostLabelOverrides.get(hostId)
      if (cloudLabel) {
        return cloudLabel
      }
      const parsed = parseExecutionHostId(hostId)
      if (parsed?.kind === 'ssh') {
        return sshTargetLabels.get(parsed.targetId) ?? parsed.targetId
      }
      if (parsed?.kind === 'runtime') {
        return (
          runtimeEnvironments.find((environment) => environment.id === parsed.environmentId)
            ?.name ?? parsed.environmentId
        )
      }
      return getLocalizedLocalExecutionHostLabel(null, i18n.resolvedLanguage)
    },
    [hostLabelOverrides, i18n.resolvedLanguage, runtimeEnvironments, sshTargetLabels]
  )
  const hostLabelById = useMemo(() => {
    const labels = new Map<string, string>([
      ['local', getLocalizedLocalExecutionHostLabel(null, i18n.resolvedLanguage)]
    ])
    for (const [targetId, label] of sshTargetLabels) {
      labels.set(`ssh:${encodeURIComponent(targetId)}`, label)
    }
    for (const environment of runtimeEnvironments) {
      labels.set(`runtime:${encodeURIComponent(environment.id)}`, environment.name)
    }
    for (const [hostId, label] of hostLabelOverrides) {
      labels.set(hostId, label)
    }
    return labels
  }, [hostLabelOverrides, i18n.resolvedLanguage, runtimeEnvironments, sshTargetLabels])
  useEffect(() => {
    if ((!selected || list.selectedExternal) && activePaneTab === 'runs') {
      setActivePaneTab('overview')
    }
  }, [activePaneTab, list.selectedExternal, selected, setActivePaneTab])

  return {
    selectedRepo,
    selectedWorktree,
    selectedRunNowAvailability,
    canSaveDraft,
    getAutomationRepoHostLabel,
    hostLabelById,
    dialogRepos: destinationForm.dialogRepos,
    dialogWorktrees: destinationForm.dialogWorktrees
  }
}

export type AutomationsPagePresentationState = ReturnType<
  typeof useAutomationsPagePresentationState
>
