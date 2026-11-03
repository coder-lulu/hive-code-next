import {
  deriveGlobalWindowsRuntimeDefaultFromLegacySettings,
  normalizeGlobalWindowsRuntimeDefault
} from '../../../shared/project-execution-runtime'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { normalizeTaskProviderSettings } from '../../../shared/task-providers'
import {
  addMobilePairingCustomAddress,
  normalizeMobilePairingCustomAddress,
  normalizeMobilePairingCustomAddresses
} from '../../../shared/mobile-pairing-custom-address'
import { normalizeSourceControlGroupOrder } from '../../../shared/source-control-group-order'
import { normalizeProjectGroups } from '../../../shared/project-groups'
import { normalizeDisabledTuiAgents } from '../../../shared/tui-agent-selection'
import { normalizeTerminalLineHeight } from '../../../shared/terminal-line-height-settings'
import {
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../../../shared/tui-agent-launch-defaults'
import {
  isAgentPermissionChoice,
  normalizeAgentPermissionOverrides
} from '../../../shared/tui-agent-permission-choice'
import {
  normalizeLoadedOnboardingState,
  normalizeNotificationSettings,
  persistedNotificationSettingsRepaired
} from '../applying-settings/onboarding-normalization'

export function prepareLoadedProfileSettings(
  parsed: PersistedState,
  defaults: PersistedState,
  markNeedsSave: () => void
) {
  const normalizedOnboarding = normalizeLoadedOnboardingState(
    parsed.onboarding,
    defaults.onboarding
  )
  if (!parsed.onboarding) {
    markNeedsSave()
  }
  const normalizedProjectGroups = normalizeProjectGroups(parsed.projectGroups)
  const rawSettings = parsed.settings
  const legacyCompact =
    rawSettings && 'experimentalCompactWorktreeCards' in rawSettings
      ? rawSettings.experimentalCompactWorktreeCards
      : undefined
  const legacyPet =
    rawSettings && 'experimentalSidekick' in rawSettings
      ? rawSettings.experimentalSidekick
      : undefined
  const loadedCompactWorktreeCards =
    rawSettings?.compactWorktreeCards ??
    (typeof legacyCompact === 'boolean' ? legacyCompact : defaults.settings.compactWorktreeCards)
  if (legacyCompact !== undefined || legacyPet !== undefined) {
    markNeedsSave()
  }
  const mobilePairingCustomAddress = normalizeMobilePairingCustomAddress(
    parsed.settings?.mobilePairingCustomAddress
  )
  const rawMobilePairingCustomAddresses = parsed.settings?.mobilePairingCustomAddresses
  const mobilePairingCustomAddresses = mobilePairingCustomAddress
    ? addMobilePairingCustomAddress(
        normalizeMobilePairingCustomAddresses(rawMobilePairingCustomAddresses),
        mobilePairingCustomAddress
      )
    : normalizeMobilePairingCustomAddresses(rawMobilePairingCustomAddresses)
  if (
    parsed.settings?.mobilePairingCustomAddress !== undefined &&
    parsed.settings.mobilePairingCustomAddress !== mobilePairingCustomAddress
  ) {
    markNeedsSave()
  }
  const customAddressesMatch =
    Array.isArray(rawMobilePairingCustomAddresses) &&
    rawMobilePairingCustomAddresses.length === mobilePairingCustomAddresses.length &&
    rawMobilePairingCustomAddresses.every(
      (address, index) => address === mobilePairingCustomAddresses[index]
    )
  if (
    (rawMobilePairingCustomAddresses !== undefined || mobilePairingCustomAddress !== null) &&
    !customAddressesMatch
  ) {
    markNeedsSave()
  }
  const normalizedNotifications = normalizeNotificationSettings(parsed.settings?.notifications)
  // Why: a type-flipped notification field is repaired in memory only; without a dirty mark the
  // bad value stays on disk and the repair reruns on every launch.
  if (
    persistedNotificationSettingsRepaired(parsed.settings?.notifications, normalizedNotifications)
  ) {
    markNeedsSave()
  }
  const normalizedSourceControlGroupOrder = normalizeSourceControlGroupOrder(
    parsed.settings?.sourceControlGroupOrder
  )
  if (
    parsed.settings?.sourceControlGroupOrder !== undefined &&
    parsed.settings.sourceControlGroupOrder !== normalizedSourceControlGroupOrder
  ) {
    markNeedsSave()
  }

  return {
    normalizedOnboarding,
    normalizedProjectGroups,
    loadedCompactWorktreeCards,
    settings: {
      experimentalPet:
        rawSettings?.experimentalPet ??
        (typeof legacyPet === 'boolean' ? legacyPet : defaults.settings.experimentalPet),
      localWindowsRuntimeDefault:
        rawSettings?.localWindowsRuntimeDefault === undefined
          ? deriveGlobalWindowsRuntimeDefaultFromLegacySettings(rawSettings).defaultRuntime
          : normalizeGlobalWindowsRuntimeDefault(rawSettings.localWindowsRuntimeDefault),
      ...normalizeTaskProviderSettings(parsed.settings ?? defaults.settings),
      terminalLineHeight: normalizeTerminalLineHeight(parsed.settings?.terminalLineHeight),
      disabledTuiAgents: normalizeDisabledTuiAgents(parsed.settings?.disabledTuiAgents),
      agentDefaultArgs: normalizeTuiAgentArgsRecord(parsed.settings?.agentDefaultArgs),
      agentDefaultEnv: normalizeTuiAgentEnvRecord(parsed.settings?.agentDefaultEnv),
      agentPermissionDefault: isAgentPermissionChoice(parsed.settings?.agentPermissionDefault)
        ? parsed.settings.agentPermissionDefault
        : 'own',
      agentPermissionOverrides: normalizeAgentPermissionOverrides(
        parsed.settings?.agentPermissionOverrides
      ),
      mobilePairingCustomAddress,
      mobilePairingCustomAddresses,
      notifications: normalizedNotifications,
      sourceControlGroupOrder: normalizedSourceControlGroupOrder
    }
  }
}

export type PreparedLoadedProfileSettings = ReturnType<typeof prepareLoadedProfileSettings>
