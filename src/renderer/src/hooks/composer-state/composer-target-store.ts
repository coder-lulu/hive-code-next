import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import {
  getComposerEligibleRepos,
  resolveComposerActiveRepoId
} from '@/lib/new-workspace-composer-repo'
import { buildExecutionHostRegistry } from '../../../../shared/execution-host-registry'
import { useExecutionHostDisplayLabels } from '@/hooks/use-execution-host-display-labels'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type { TaskSourceContext } from '../../../../shared/task-source-context'
import type { WorkspaceStatus } from '../../../../shared/worktree/types'
import type { WorkspaceSource as WorkspaceCreateTelemetrySource } from '../../../../shared/workspace-source'
import type { AgentLaunchPermissionMode } from '../../../../shared/tui-agent-permissions'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import type { ComposerDecisions } from './composer-decisions'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { localizeExecutionHostRegistry } from '@/lib/localized-execution-host-label'

export type ComposerStateInput = {
  initialRepoId?: string
  initialExecutionHostId?: ExecutionHostId
  initialEphemeralVmRecipeId?: string
  initialProjectGroupId?: string
  initialName?: string
  initialPrompt?: string
  agentPermissionMode?: AgentLaunchPermissionMode
  initialLinkedWorkItem?: LinkedWorkItemSummary | null
  initialGitHubWorkItem?: GitHubWorkItem | null
  initialTaskSourceContext?: TaskSourceContext | null
  initialWorkspaceStatus?: WorkspaceStatus
  initialBaseBranch?: string
  persistDraft: boolean
  onCreated?: () => void
  isSubmissionCancelled?: () => boolean
  repoIdOverride?: string
  onRepoIdOverrideChange?: (value: string) => void
  telemetrySource?: WorkspaceCreateTelemetrySource
  enableIssueAutomation?: boolean
  createGateMode?: 'full' | 'quick'
}

const NEVER_CANCEL_COMPOSER_SUBMIT = (): boolean => false

export function useComposerTargetStore(options: ComposerStateInput, decisions: ComposerDecisions) {
  const { i18n } = useTranslation()
  const {
    initialRepoId,
    initialExecutionHostId,
    initialEphemeralVmRecipeId,
    initialName = '',
    initialPrompt = '',
    agentPermissionMode = 'default',
    initialLinkedWorkItem = null,
    initialGitHubWorkItem = null,
    initialTaskSourceContext = null,
    initialWorkspaceStatus,
    initialBaseBranch,
    persistDraft,
    onCreated,
    isSubmissionCancelled = NEVER_CANCEL_COMPOSER_SUBMIT,
    repoIdOverride,
    onRepoIdOverrideChange,
    telemetrySource,
    enableIssueAutomation = true,
    createGateMode = 'full',
    initialProjectGroupId
  } = options

  const actions = useAppStore(
    useShallow((s) => ({
      setNewWorkspaceDraft: s.setNewWorkspaceDraft,
      clearNewWorkspaceDraft: s.clearNewWorkspaceDraft,
      createWorktree: s.createWorktree,
      updateRepo: s.updateRepo,
      updateWorktreeMeta: s.updateWorktreeMeta,
      createFolderWorkspace: s.createFolderWorkspace,
      setSidebarOpen: s.setSidebarOpen,
      closeModal: s.closeModal,
      openSettingsPage: s.openSettingsPage,
      openSettingsTarget: s.openSettingsTarget,
      setActiveRuntimeEnvironmentPreference: s.setActiveRuntimeEnvironmentPreference,
      prefetchWorktreeCreateBase: s.prefetchWorktreeCreateBase,
      prefetchWorkItems: s.prefetchWorkItems,
      fetchSparsePresets: s.fetchSparsePresets
    }))
  )

  const {
    setNewWorkspaceDraft,
    clearNewWorkspaceDraft,
    createWorktree,
    updateRepo,
    updateWorktreeMeta,
    createFolderWorkspace,
    setSidebarOpen,
    closeModal,
    openSettingsPage,
    openSettingsTarget,
    setActiveRuntimeEnvironmentPreference,
    prefetchWorktreeCreateBase,
    prefetchWorkItems,
    fetchSparsePresets
  } = actions

  const repos = useAppStore((s) => s.repos)

  const projects = useAppStore((s) => s.projects)

  const projectGroups = useAppStore((s) => s.projectGroups)

  const projectHostSetups = useAppStore((s) => s.projectHostSetups)

  const activeRepoId = useAppStore((s) => s.activeRepoId)

  const settings = useAppStore((s) => s.settings)

  const newWorkspaceDraft = useAppStore((s) => s.newWorkspaceDraft)

  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)

  const sparsePresetsByRepo = useAppStore((s) => s.sparsePresetsByRepo)

  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)

  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)

  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)

  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)

  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)

  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)

  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)

  const eligibleRepos = useMemo(() => getComposerEligibleRepos(repos), [repos])

  const hostLabelOverrides = useExecutionHostDisplayLabels()
  const hostOptions = useMemo(
    () =>
      localizeExecutionHostRegistry(
        buildExecutionHostRegistry({
          repos,
          settings,
          hostSource: 'configured-only',
          sshTargetLabels,
          sshConnectionStates,
          runtimeEnvironments,
          runtimeStatusByEnvironmentId,
          hostLabelOverrides: hostLabelOverrides
        }),
        hostLabelOverrides,
        i18n.resolvedLanguage
      ),
    [
      i18n.resolvedLanguage,
      hostLabelOverrides,
      repos,
      settings,
      sshConnectionStates,
      sshTargetLabels,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )

  const actionableHostIds = useMemo(
    () => new Set(hostOptions.map((host) => host.id)),
    [hostOptions]
  )

  const seedActiveRepoId = useMemo(
    () => resolveComposerActiveRepoId(repos, eligibleRepos, activeRepoId),
    [repos, eligibleRepos, activeRepoId]
  )

  return {
    initialRepoId,
    initialExecutionHostId,
    initialEphemeralVmRecipeId,
    initialName,
    initialPrompt,
    agentPermissionMode,
    initialLinkedWorkItem,
    initialGitHubWorkItem,
    initialTaskSourceContext,
    initialWorkspaceStatus,
    initialBaseBranch,
    persistDraft,
    onCreated,
    isSubmissionCancelled,
    repoIdOverride,
    onRepoIdOverrideChange,
    telemetrySource,
    enableIssueAutomation,
    createGateMode,
    initialProjectGroupId,
    decisions,
    actions,
    setNewWorkspaceDraft,
    clearNewWorkspaceDraft,
    createWorktree,
    updateRepo,
    updateWorktreeMeta,
    createFolderWorkspace,
    setSidebarOpen,
    closeModal,
    openSettingsPage,
    openSettingsTarget,
    setActiveRuntimeEnvironmentPreference,
    prefetchWorktreeCreateBase,
    prefetchWorkItems,
    fetchSparsePresets,
    repos,
    projects,
    projectGroups,
    projectHostSetups,
    activeRepoId,
    settings,
    newWorkspaceDraft,
    worktreesByRepo,
    sparsePresetsByRepo,
    workspaceStatuses,
    sshConnectionStates,
    sshTargetLabels,
    sshConnectedGeneration,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    workspaceHostScope,
    eligibleRepos,
    hostOptions,
    actionableHostIds,
    seedActiveRepoId
  }
}
