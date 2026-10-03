import { AiServicesPane } from './AiServicesPane'
import { AgentsPane } from './AgentsPane'
import { AgentDetectionRefreshButton } from './AgentDetectionRefreshButton'
import { AgentCapabilitiesPane } from './AgentCapabilitiesPane'
import { LinearAgentSkillPane } from './LinearAgentSkillPane'
import { VoicePane } from './VoicePane'
import { SettingsSection } from './SettingsSection'
import { translate } from '@/i18n/i18n'
import { APP_DISPLAY_NAME } from '@/product-brand'
import type { SettingsRenderContext } from './settings-render-context'

export function renderAgentsSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { model, navigation, terminal, view } = context
  return (
    <SettingsSection
      id="agents"
      title={translate('auto.components.settings.Settings.8afa676615', 'Agents')}
      description={translate(
        'agentsSettings.description',
        'Manage coding agents and launch preferences'
      )}
      searchEntries={navigation.getSectionSearchEntries('agents')}
      headerClassName="border-0 pb-0"
      bodyClassName="rounded-none border-0 bg-transparent p-0 shadow-none"
      headerAction={
        view.isSectionMounted('agents') ? (
          <AgentDetectionRefreshButton settings={model.settings} />
        ) : null
      }
    >
      {view.isSectionMounted('agents') ? (
        <AgentsPane
          settings={model.settings}
          updateSettings={model.updateSettings}
          wslSupportedPlatform={terminal.localWslSupportedPlatform}
          wslAvailable={terminal.localWindowsRuntimeCapabilities.wslAvailable}
          wslDistros={terminal.localWindowsRuntimeCapabilities.wslDistros}
          wslCapabilitiesLoading={terminal.localWindowsRuntimeCapabilities.isLoading}
        />
      ) : null}
    </SettingsSection>
  )
}

export function renderAccountsSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { interactions, model, navigation, terminal, view } = context
  const pendingAccountsTarget =
    interactions.pendingNavSectionRef.current === 'accounts'
      ? interactions.pendingScrollTargetRef.current
      : null
  return (
    <SettingsSection
      id="accounts"
      title={translate('aiServices.title', 'AI Services & Usage')}
      description={translate(
        'aiServices.description',
        'View usage trends and manage AI provider accounts.'
      )}
      searchEntries={navigation.getSectionSearchEntries('accounts')}
      headerClassName="border-0 pb-0"
      bodyClassName="rounded-none border-0 bg-transparent p-0 shadow-none"
    >
      {view.isSectionMounted('accounts') ? (
        <AiServicesPane
          navigationRequest={model.settingsNavigationTarget}
          settings={model.settings}
          updateSettings={model.updateSettings}
          wslSupportedPlatform={terminal.runtimeWslSupportedPlatform}
          wslAvailable={terminal.windowsTerminalCapabilities.wslAvailable}
          wslDistros={terminal.windowsTerminalCapabilities.wslDistros}
          wslCapabilitiesLoading={terminal.windowsTerminalCapabilities.isLoading}
          accountOwnerPlatform={terminal.windowsTerminalCapabilities.hostPlatform}
          navigationTargetSectionId={
            model.settingsNavigationTarget?.pane === 'accounts'
              ? model.settingsNavigationTarget.sectionId
              : pendingAccountsTarget
          }
        />
      ) : null}
    </SettingsSection>
  )
}

export function renderAgentCapabilitiesSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element {
  const { interactions, model, navigation, view } = context
  return (
    <SettingsSection
      id="agent-capabilities"
      title={translate('agentCapabilities.settings.title', 'Agent Capabilities')}
      description={translate(
        'agentCapabilities.settings.description',
        'Configure multi-agent collaboration and desktop operation.'
      )}
      searchEntries={navigation.getSectionSearchEntries('agent-capabilities')}
      bodyClassName="rounded-none border-0 bg-transparent p-0 shadow-none"
    >
      {view.isSectionMounted('agent-capabilities') ? (
        <AgentCapabilitiesPane
          settings={model.settings}
          updateSettings={model.updateSettings}
          showComputerUse={model.showDesktopOnlySettings}
          navigationTargetSectionId={
            interactions.pendingNavSectionRef.current === 'agent-capabilities'
              ? (interactions.pendingScrollTargetRef.current ?? undefined)
              : undefined
          }
        />
      ) : null}
    </SettingsSection>
  )
}

export function renderLinearSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.linearConnected ? (
    <SettingsSection
      id="linear"
      title={translate('auto.components.settings.Settings.linearTitle', 'Linear')}
      description={translate(
        'auto.components.settings.Settings.linearDescription',
        'How Linear works in {{value0}}, setup checklist, agent skill, and example prompts.',
        { value0: APP_DISPLAY_NAME }
      )}
      searchEntries={navigation.getSectionSearchEntries('linear')}
    >
      {view.isSectionMounted('linear') ? <LinearAgentSkillPane /> : null}
    </SettingsSection>
  ) : null
}

export function renderDesktopCapabilitySettingsSections(
  context: SettingsRenderContext
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings ? (
    <SettingsSection
      id="voice"
      title={translate('auto.components.settings.Settings.5063bb47a5', 'Voice')}
      description={translate(
        'auto.components.settings.Settings.eb1176a14e',
        'Local speech-to-text dictation with on-device models.'
      )}
      searchEntries={navigation.getSectionSearchEntries('voice')}
    >
      {view.isSectionMounted('voice') ? (
        <VoicePane settings={model.settings} updateSettings={model.updateSettings} />
      ) : null}
    </SettingsSection>
  ) : null
}
