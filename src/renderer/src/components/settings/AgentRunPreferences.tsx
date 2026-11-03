import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { applyAllAgentsPermission, AGENT_PERMISSION_CHOICES, isAgentPermissionChoice, type AgentPermissionChoice } from '../../../../shared/tui-agent-permission-choice'
import { NativeChatPermissionModePicker } from '../native-chat/NativeChatPermissionModePicker'
import { translate } from '@/i18n/i18n'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import { AgentAwakeSetting } from './AgentAwakeSetting'
import { AgentCacheTimerSection } from './AgentCacheTimerSection'
import {
  getAgentGeneratedTabTitlesDescription,
  getAgentGeneratedTabTitlesTitle
} from './agent-generated-tab-title-copy'
import { getAgentStatusHooksDescription, getAgentStatusHooksTitle } from './agent-status-hooks-copy'
import {
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'

type AgentRunPreferencesProps = {
  permissions?: React.ReactNode
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function AgentRunPreferences(props: AgentRunPreferencesProps) {
  const { settings, updateSettings } = props
  return (
    <div className="agents-preferences">
      <section id="agent-status-hooks">
        <AgentStatusHooksSetting {...props} />
      </section>
      <section id="agent-tab-titles">
        <AgentGeneratedTabTitlesSetting {...props} />
      </section>
      {!isPairedWebClientWindow() ? (
        <section id="agent-awake">
          <AgentAwakeSetting {...props} />
        </section>
      ) : null}
      <section id="agent-cache-timer">
        <AgentCacheTimerSection {...props} />
      </section>
      <section id="agent-permissions">
        {props.permissions ?? (
          <AgentPermissionsSetting
            mode={isAgentPermissionChoice(settings.agentPermissionDefault) ? settings.agentPermissionDefault : 'own'}
            onChange={(mode) =>
              updateSettings(applyAllAgentsPermission(settings, mode))
            }
          />
        )}
      </section>
    </div>
  )
}

export function AgentPermissionsSetting({ mode, onChange }: {
  mode: AgentPermissionChoice
  onChange: (mode: AgentPermissionChoice) => void
}) {
  return <section className="space-y-3"><SettingsSubsectionHeader
    title={translate('auto.components.settings.AgentsPane.agentPermissions', 'Agent Permissions')}
    action={<NativeChatPermissionModePicker current={mode} modes={AGENT_PERMISSION_CHOICES} onSelect={onChange} />}
  /></section>
}

export function AgentStatusHooksSetting({ settings, updateSettings }: AgentRunPreferencesProps) {
  const enabled = settings.agentStatusHooksEnabled !== false
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={getAgentStatusHooksTitle()}
        description={getAgentStatusHooksDescription()}
        checked={enabled}
        onChange={() => updateSettings({ agentStatusHooksEnabled: !enabled })}
        ariaLabel={getAgentStatusHooksTitle()}
      />
    </section>
  )
}

export function AgentGeneratedTabTitlesSetting({
  settings,
  updateSettings
}: AgentRunPreferencesProps) {
  const enabled = settings.tabAutoGenerateTitle === true
  return (
    <section className="space-y-3">
      <SettingsSwitchRow
        label={getAgentGeneratedTabTitlesTitle()}
        description={getAgentGeneratedTabTitlesDescription()}
        checked={enabled}
        onChange={() => updateSettings({ tabAutoGenerateTitle: !enabled })}
        ariaLabel={getAgentGeneratedTabTitlesTitle()}
      />
    </section>
  )
}
