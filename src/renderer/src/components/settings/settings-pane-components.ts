import { createElement, Suspense, type ComponentProps, type ComponentType } from 'react'
import {
  lazyWithRetry as createLazyComponent,
  type LazyWithRetryOptions
} from '@/lib/lazy-with-retry'
import { SettingsPaneLoading } from './SettingsPaneLoading'
import { loadHiveAccountSettingsPane } from './settings-page-loader'
import type { PluginsSettingsSection as PluginsSettingsSectionComponent } from './PluginsSettingsSection'

type PluginsSettingsSectionProps = Parameters<typeof PluginsSettingsSectionComponent>[0]

// Mirror React.lazy's component constraint so inference preserves every pane's exact props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SettingsPaneComponent = ComponentType<any>

function lazyWithRetry<T extends SettingsPaneComponent>(
  factory: () => Promise<{ default: T }>,
  options?: LazyWithRetryOptions
): ComponentType<ComponentProps<T>> {
  const LazyPane = createLazyComponent(factory, options)
  return function SettingsPaneWithLoading(props: ComponentProps<T>): React.JSX.Element {
    return createElement(
      Suspense,
      { fallback: createElement(SettingsPaneLoading) },
      createElement(LazyPane, props)
    )
  }
}

export const GeneralPane = lazyWithRetry(
  () => import('./GeneralPane').then((module) => ({ default: module.GeneralPane })),
  { reloadKey: 'settings.general' }
)
export const BrowserPane = lazyWithRetry(
  () => import('./BrowserPane').then((module) => ({ default: module.BrowserPane })),
  { reloadKey: 'settings.browser' }
)
export const AppearancePane = lazyWithRetry(
  () => import('./AppearancePane').then((module) => ({ default: module.AppearancePane })),
  { reloadKey: 'settings.appearance' }
)
export const InputPane = lazyWithRetry(
  () => import('./InputPane').then((module) => ({ default: module.InputPane })),
  { reloadKey: 'settings.input' }
)
export const ShortcutsPane = lazyWithRetry(
  () => import('./ShortcutsPane').then((module) => ({ default: module.ShortcutsPane })),
  { reloadKey: 'settings.shortcuts' }
)
export const TerminalPane = lazyWithRetry(
  () => import('./TerminalPane').then((module) => ({ default: module.TerminalPane })),
  { reloadKey: 'settings.terminal' }
)
export const FloatingWorkspacePane = lazyWithRetry(
  () =>
    import('./FloatingWorkspacePane').then((module) => ({ default: module.FloatingWorkspacePane })),
  { reloadKey: 'settings.floating-workspace' }
)
export const RepositoryPane = lazyWithRetry(
  () => import('./RepositoryPane').then((module) => ({ default: module.RepositoryPane })),
  { reloadKey: 'settings.repository' }
)
export const GitPane = lazyWithRetry(
  () => import('./GitPane').then((module) => ({ default: module.GitPane })),
  { reloadKey: 'settings.git' }
)
export const CommitMessageAiPane = lazyWithRetry(
  () => import('./CommitMessageAiPane').then((module) => ({ default: module.CommitMessageAiPane })),
  { reloadKey: 'settings.commit-message-ai' }
)
export const GitProviderApiBudgetPane = lazyWithRetry(
  () =>
    import('./GitProviderApiBudgetPane').then((module) => ({
      default: module.GitProviderApiBudgetPane
    })),
  { reloadKey: 'settings.git-provider-api-budget' }
)
export const NotificationsPane = lazyWithRetry(
  () => import('./NotificationsPane').then((module) => ({ default: module.NotificationsPane })),
  { reloadKey: 'settings.notifications' }
)
export const VoicePane = lazyWithRetry(
  () => import('./VoicePane').then((module) => ({ default: module.VoicePane })),
  { reloadKey: 'settings.voice' }
)
export const SshPane = lazyWithRetry(
  () => import('./SshPane').then((module) => ({ default: module.SshPane })),
  { reloadKey: 'settings.ssh' }
)
export const ExperimentalPane = lazyWithRetry(
  () => import('./ExperimentalPane').then((module) => ({ default: module.ExperimentalPane })),
  { reloadKey: 'settings.experimental' }
)
const LazyPluginsSettingsSection = lazyWithRetry(
  () =>
    import('./PluginsSettingsSection').then((module) => ({
      default: module.PluginsSettingsSection
    })),
  { reloadKey: 'settings.plugins' }
)
export function PluginsSettingsSection(
  props: PluginsSettingsSectionProps
): React.JSX.Element | null {
  return props.mounted ? createElement(LazyPluginsSettingsSection, props) : null
}
export const AgentsPane = lazyWithRetry(
  () => import('./AgentsPane').then((module) => ({ default: module.AgentsPane })),
  { reloadKey: 'settings.agents' }
)
export const OrchestrationPane = lazyWithRetry(
  () => import('./OrchestrationPane').then((module) => ({ default: module.OrchestrationPane })),
  { reloadKey: 'settings.orchestration' }
)
export const ArtifactsSettingsPane = lazyWithRetry(
  () =>
    import('./ArtifactsSettingsPane').then((module) => ({
      default: module.ArtifactsSettingsPane
    })),
  { reloadKey: 'settings.artifacts' }
)
export const ShareSkillsSettingsPane = lazyWithRetry(
  () =>
    import('./ShareSkillsSettingsPane').then((module) => ({
      default: module.ShareSkillsSettingsPane
    })),
  { reloadKey: 'settings.share-skills' }
)
export const AutomationsSettingsPane = lazyWithRetry(
  () =>
    import('./AutomationsSettingsPane').then((module) => ({
      default: module.AutomationsSettingsPane
    })),
  { reloadKey: 'settings.automations' }
)
export const HiveAccountSettingsPane = lazyWithRetry(loadHiveAccountSettingsPane, {
  reloadKey: 'settings.hive-account'
})
export const LinearAgentSkillPane = lazyWithRetry(
  () =>
    import('./LinearAgentSkillPane').then((module) => ({ default: module.LinearAgentSkillPane })),
  { reloadKey: 'settings.linear' }
)
export const AccountsPane = lazyWithRetry(
  () => import('./AccountsPane').then((module) => ({ default: module.AccountsPane })),
  { reloadKey: 'settings.accounts' }
)
export const StatsPane = lazyWithRetry(
  () => import('../stats/StatsPane').then((module) => ({ default: module.StatsPane })),
  { reloadKey: 'settings.stats' }
)
export const IntegrationsPane = lazyWithRetry(
  () => import('./IntegrationsPane').then((module) => ({ default: module.IntegrationsPane })),
  { reloadKey: 'settings.integrations' }
)
export const TasksPane = lazyWithRetry(
  () => import('./TasksPane').then((module) => ({ default: module.TasksPane })),
  { reloadKey: 'settings.tasks' }
)
export const QuickCommandsPane = lazyWithRetry(
  () => import('./QuickCommandsPane').then((module) => ({ default: module.QuickCommandsPane })),
  { reloadKey: 'settings.quick-commands' }
)
export const DeveloperPermissionsPane = lazyWithRetry(
  () =>
    import('./DeveloperPermissionsPane').then((module) => ({
      default: module.DeveloperPermissionsPane
    })),
  { reloadKey: 'settings.developer-permissions' }
)
export const ComputerUsePane = lazyWithRetry(
  () => import('./ComputerUsePane').then((module) => ({ default: module.ComputerUsePane })),
  { reloadKey: 'settings.computer-use' }
)
export const MobileSettingsPane = lazyWithRetry(
  () => import('./MobileSettingsPane').then((module) => ({ default: module.MobileSettingsPane })),
  { reloadKey: 'settings.mobile' }
)
export const MobileEmulatorSettingsPane = lazyWithRetry(
  () =>
    import('./MobileEmulatorSettingsPane').then((module) => ({
      default: module.MobileEmulatorSettingsPane
    })),
  { reloadKey: 'settings.mobile-emulator' }
)
export const RuntimeEnvironmentsPane = lazyWithRetry(
  () =>
    import('./RuntimeEnvironmentsPane').then((module) => ({
      default: module.RuntimeEnvironmentsPane
    })),
  { reloadKey: 'settings.runtime-environments' }
)
export const PrivacyPane = lazyWithRetry(
  () => import('./PrivacyPane').then((module) => ({ default: module.PrivacyPane })),
  { reloadKey: 'settings.privacy' }
)
export const AdvancedPane = lazyWithRetry(
  () => import('./AdvancedPane').then((module) => ({ default: module.AdvancedPane })),
  { reloadKey: 'settings.advanced' }
)
export const SettingsSetupGuidePane = lazyWithRetry(
  () =>
    import('./SettingsSetupGuidePane').then((module) => ({
      default: module.SettingsSetupGuidePane
    })),
  { reloadKey: 'settings.setup-guide' }
)
