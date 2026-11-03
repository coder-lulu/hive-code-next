import {
  isAgentPermissionChoice,
  normalizeAgentPermissionOverrides
} from '../../../../shared/tui-agent-permission-choice'
import { normalizeNativeChatProviders } from '../../../../shared/structured-native-chat-launch-route'
import { normalizeNativeChatAppearanceSettings } from '../../../../shared/native-chat/native-chat-appearance-settings'
import { normalizeAutoRenameBranchFromWorkDefaultOn } from '../../../../shared/auto-rename-branch-from-work-settings'
import {
  getDefaultSettings,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties
} from '../../../../shared/constants'
import { normalizeContextualTourIds } from '../../../../shared/contextual-tours'
import type { ContextualTourId } from '../../../../shared/contextual-tours'
import { normalizeFeatureInteractions } from '../../../../shared/feature-interactions'
import type {
  FeatureInteractionId,
  FeatureInteractionState
} from '../../../../shared/feature-interactions'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { PairedUiState, PairingLocalUiField } from '../../../../shared/pairing-local-ui-fields'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'
import { normalizeStatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import { normalizeTerminalCustomThemes } from '../../../../shared/terminal-custom-themes'
import {
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../../../../shared/tui-agent-launch-defaults'
import { normalizeDisabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { normalizeUiLanguage } from '../../../../shared/ui-language'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { mergeWorkspaceCleanupUIState } from '../../../../shared/workspace-cleanup-ui-state'

export function mergeWebUIState(
  base: PersistedUIState,
  updates: Partial<PersistedUIState>
): PersistedUIState {
  const { featureInteractionTelemetryBuckets: _reserved, ...safeUpdates } =
    updates as Partial<PersistedUIState> & {
      featureInteractionTelemetryBuckets?: unknown
    }
  void _reserved
  const merged = {
    ...base,
    ...safeUpdates,
    workspaceCleanup: mergeWorkspaceCleanupUIState(
      base.workspaceCleanup,
      safeUpdates.workspaceCleanup
    ),
    worktreeCardProperties: normalizeWorktreeCardProperties(
      safeUpdates.worktreeCardProperties ?? base.worktreeCardProperties
    ),
    _worktreeCardModeDefaulted:
      safeUpdates._worktreeCardModeDefaulted ?? base._worktreeCardModeDefaulted,
    agentActivityDisplayMode: normalizeAgentActivityDisplayMode(
      safeUpdates.agentActivityDisplayMode ?? base.agentActivityDisplayMode
    ),
    usagePercentageDisplay: normalizeUsagePercentageDisplay(
      safeUpdates.usagePercentageDisplay ?? base.usagePercentageDisplay
    ),
    statusBarUsageMode: normalizeStatusBarUsageMode(
      safeUpdates.statusBarUsageMode ?? base.statusBarUsageMode
    )
  }
  delete merged.osc52ClipboardDefaultOnNoticePending
  return merged
}

export function mergeHostWebUIState(
  local: PersistedUIState,
  incoming: PairedUiState
): PersistedUIState {
  // Why `satisfies Record<...>` rather than a `Pick<...>` annotation: every member is optional in
  // PersistedUIState, so Pick would accept a literal that silently skipped a newly added member.
  const pinned = {
    automationHostFilter: local.automationHostFilter,
    hideWorkspacesFromOtherDevices: local.hideWorkspacesFromOtherDevices === true,
    manualRepoOrder: local.manualRepoOrder,
    workspaceHostOrder: local.workspaceHostOrder,
    sidebarOpen: local.sidebarOpen,
    showAgentModels: local.showAgentModels,
    agentsVisibleHostIds: local.agentsVisibleHostIds,
    agentsFilterRepoIds: local.agentsFilterRepoIds,
    agentsHideWorkspacesFromOtherDevices: local.agentsHideWorkspacesFromOtherDevices === true,
    agentsHideAutomationGeneratedWorkspaces: local.agentsHideAutomationGeneratedWorkspaces === true,
    agentsHideCliCreatedWorkspaces: local.agentsHideCliCreatedWorkspaces === true,
    agentsShowChildAgents: local.agentsShowChildAgents,
    agentsCompactMode: local.agentsCompactMode,
    agentsShowSearch: local.agentsShowSearch,
    agentsReadFilter: local.agentsReadFilter,
    agentsGroupBy: local.agentsGroupBy,
    activityClearedAtByPaneKey: local.activityClearedAtByPaneKey,
    manuallyUnreadTurnsByPaneKey: local.manuallyUnreadTurnsByPaneKey
  } satisfies Record<PairingLocalUiField, unknown> & Partial<PersistedUIState>
  return {
    ...mergeWebUIState(local, incoming),
    ...pinned,
    // Old hosts omit this field; a cached arm must not make their strict ui.set reject mode changes.
    statusBarCompactChangeNoticeDismissed: incoming.statusBarCompactChangeNoticeDismissed !== false
  }
}

export function mergeFeatureInteractionState(
  current: PersistedUIState['featureInteractions'],
  incoming: PersistedUIState['featureInteractions']
): FeatureInteractionState {
  const currentNormalized = normalizeFeatureInteractions(current)
  const incomingNormalized = normalizeFeatureInteractions(incoming)
  const merged: FeatureInteractionState = { ...currentNormalized }
  for (const [id, incomingRecord] of Object.entries(incomingNormalized)) {
    const featureId = id as FeatureInteractionId
    const currentRecord = currentNormalized[featureId]
    merged[featureId] = currentRecord
      ? {
          firstInteractedAt: Math.min(
            currentRecord.firstInteractedAt,
            incomingRecord.firstInteractedAt
          ),
          interactionCount: Math.max(
            currentRecord.interactionCount,
            incomingRecord.interactionCount
          )
        }
      : incomingRecord
  }
  return merged
}

export function mergeContextualTourSeenIds(
  current: PersistedUIState['contextualToursSeenIds'],
  incoming: PersistedUIState['contextualToursSeenIds']
): ContextualTourId[] {
  const merged = new Set<ContextualTourId>(normalizeContextualTourIds(current))
  for (const id of normalizeContextualTourIds(incoming)) {
    merged.add(id)
  }
  return [...merged]
}

export function mergeSettings(
  base: GlobalSettings,
  updates: Partial<GlobalSettings>
): GlobalSettings {
  const defaults = getDefaultSettings('~')
  const merged = {
    ...base,
    ...updates,
    notifications: {
      // Why: browser-stored settings can predate a newer notification field.
      ...defaults.notifications,
      ...base.notifications,
      ...updates.notifications
    },
    githubProjects: {
      ...(base.githubProjects ?? defaults.githubProjects),
      ...updates.githubProjects
    } as GlobalSettings['githubProjects'],
    disabledTuiAgents: normalizeDisabledTuiAgents(
      updates.disabledTuiAgents ?? base.disabledTuiAgents
    ),
    agentDefaultArgs: normalizeTuiAgentArgsRecord(
      updates.agentDefaultArgs ?? base.agentDefaultArgs
    ),
    agentDefaultEnv: normalizeTuiAgentEnvRecord(updates.agentDefaultEnv ?? base.agentDefaultEnv),
    voice: {
      ...(base.voice ?? defaults.voice),
      ...updates.voice
    } as NonNullable<GlobalSettings['voice']>,
    activeRuntimeEnvironmentId: Object.hasOwn(updates, 'activeRuntimeEnvironmentId')
      ? (updates.activeRuntimeEnvironmentId ?? null)
      : (base.activeRuntimeEnvironmentId ?? null),
    terminalCustomThemes: normalizeTerminalCustomThemes(
      updates.terminalCustomThemes ?? base.terminalCustomThemes
    ),
    nativeChatAppearance: normalizeNativeChatAppearanceSettings(
      Object.hasOwn(updates, 'nativeChatAppearance')
        ? updates.nativeChatAppearance
        : base.nativeChatAppearance
    ),
    uiLanguage: normalizeUiLanguage(updates.uiLanguage ?? base.uiLanguage)
  }
  const settings = {
    ...merged,
    ...normalizeAutoRenameBranchFromWorkDefaultOn(merged),
    ...runtimeChatPermissionSetting(merged)
  }
  Reflect.deleteProperty(settings, 'autoRenameBranchFromWorkDefaultedOn')
  Reflect.deleteProperty(settings, 'terminalAllowOsc52ClipboardDefaultedOnForAllUsers')
  Reflect.deleteProperty(settings, 'terminalCursorStyleDefaultedToBlock')
  Reflect.deleteProperty(settings, 'nativeChatPermissionMode')
  Reflect.deleteProperty(settings, 'experimentalNativeChat')
  return settings
}

/** Project only current, own settings. Missing fields in a patch never invent a write. */
export function runtimeChatPermissionSetting(
  settings: unknown
): Pick<
  GlobalSettings,
  'nativeChatProviders' | 'agentPermissionDefault' | 'agentPermissionOverrides'
> {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('Chat settings unavailable')
  }
  const result: Pick<
    GlobalSettings,
    'nativeChatProviders' | 'agentPermissionDefault' | 'agentPermissionOverrides'
  > = {}
  if (Object.hasOwn(settings, 'nativeChatProviders')) {
    const providers = Reflect.get(settings, 'nativeChatProviders')
    if (
      !providers ||
      typeof providers !== 'object' ||
      Array.isArray(providers) ||
      Object.values(providers).some((value) => typeof value !== 'boolean')
    ) {
      throw new Error('Chat provider settings unavailable')
    }
    result.nativeChatProviders = normalizeNativeChatProviders(providers)
  }
  if (Object.hasOwn(settings, 'agentPermissionDefault')) {
    const choice = Reflect.get(settings, 'agentPermissionDefault')
    if (!isAgentPermissionChoice(choice)) {
      throw new Error('Chat permission settings unavailable')
    }
    result.agentPermissionDefault = choice
  }
  if (Object.hasOwn(settings, 'agentPermissionOverrides')) {
    const overrides = Reflect.get(settings, 'agentPermissionOverrides')
    if (
      !overrides ||
      typeof overrides !== 'object' ||
      Array.isArray(overrides) ||
      Object.values(overrides).some((value) => !isAgentPermissionChoice(value))
    ) {
      throw new Error('Chat permission overrides unavailable')
    }
    result.agentPermissionOverrides = normalizeAgentPermissionOverrides(overrides)
  }
  return result
}

export function mergeOsc52ClipboardNoticePending(
  current: PersistedUIState,
  incoming: PersistedUIState
): boolean {
  return (
    current.osc52ClipboardDefaultOnNoticePending === true ||
    incoming.osc52ClipboardDefaultOnNoticePending === true
  )
}
