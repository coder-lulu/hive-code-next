import { DeveloperPermissionsPane } from './DeveloperPermissionsPane'
import { PrivacyPane } from './PrivacyPane'
import { DeviceConnectionsPane } from './DeviceConnectionsPane'
import { WorkEnvironmentsPane } from './WorkEnvironmentsPane'
import { SettingsSection } from './SettingsSection'
import { translate } from '@/i18n/i18n'
import type { SettingsRenderContext } from './settings-render-context'

export function renderServersSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="servers"
      title={translate('deviceConnections.title', 'Devices & connections')}
      description={translate(
        'deviceConnections.description',
        'Manage your computers, connect to this computer and control cross-device access.'
      )}
      searchEntries={navigation.getSectionSearchEntries('servers')}
    >
      {view.isSectionMounted('servers') ? (
        <DeviceConnectionsPane
          settings={model.settings}
          setActiveRuntimeEnvironmentPreference={model.setActiveRuntimeEnvironmentPreference}
          isWebClient={model.isWebClient}
          active={model.activeSectionId === 'servers' || model.settingsSearchQuery.trim() !== ''}
          requestedSectionId={model.highlightedSettingsTargetId}
          searchQuery={model.settingsSearchQuery}
          navigationRevision={model.pendingNavRequestTick}
          sshHostAddIntentSignal={model.sshHostAddIntentSignal}
          addServerIntentSignal={model.remoteServerAddIntentSignal}
        />
      ) : null}
    </SettingsSection>
  )
}

export function renderWorkEnvironmentsSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings ? (
    <SettingsSection
      id="work-environments"
      title={translate('deviceConnections.environments', 'Work environments')}
      description={translate(
        'deviceConnections.environmentsDescription',
        'Configure workspace environment recipes and manage the cloud machines they create.'
      )}
      searchEntries={navigation.getSectionSearchEntries('work-environments')}
    >
      {view.isSectionMounted('work-environments') ? (
        <WorkEnvironmentsPane
          settings={model.settings}
          updateSettings={model.updateSettings}
          active={
            model.activeSectionId === 'work-environments' || model.settingsSearchQuery.trim() !== ''
          }
        />
      ) : null}
    </SettingsSection>
  ) : null
}

export function renderDeveloperPermissionsSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element | null {
  const { model, navigation, view } = context
  return model.showDesktopOnlySettings && model.isMac ? (
    <SettingsSection
      id="developer-permissions"
      title={translate('auto.components.settings.Settings.65660d4548', 'macOS Permissions')}
      description={translate(
        'auto.components.settings.Settings.9b83cc62c2',
        'macOS privacy access for terminal-launched developer tools.'
      )}
      searchEntries={navigation.getSectionSearchEntries('developer-permissions')}
    >
      {view.isSectionMounted('developer-permissions') ? (
        <DeveloperPermissionsPane highlightedSettingId={model.highlightedSettingsTargetId} />
      ) : null}
    </SettingsSection>
  ) : null
}

export function renderPrivacySettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { model, navigation, view } = context
  return (
    <SettingsSection
      id="privacy"
      title={translate('auto.components.settings.Settings.d7e3f62d70', 'Privacy & Telemetry')}
      description={translate(
        'auto.components.settings.Settings.c1b43dc4e2',
        'Anonymous usage data and telemetry controls.'
      )}
      searchEntries={navigation.getSectionSearchEntries('privacy')}
    >
      {view.isSectionMounted('privacy') ? <PrivacyPane settings={model.settings} /> : null}
    </SettingsSection>
  )
}
