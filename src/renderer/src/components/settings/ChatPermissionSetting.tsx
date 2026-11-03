import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { AGENT_PERMISSION_CHOICES, applyAllAgentsPermission, isAgentPermissionChoice } from '../../../../shared/tui-agent-permission-choice'
import { NativeChatPermissionModePicker } from '../native-chat/NativeChatPermissionModePicker'
import { SettingsRow } from './SettingsFormControls'
import { SearchableSetting } from './SearchableSetting'
import { getChatPermissionSearchEntry } from './chat-permission-search'

/** This host's profile default; explicit per-agent and existing chat choices survive. */
export function ChatPermissionSetting({
  settings,
  updateSettings,
  forceVisible
}: {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  forceVisible: boolean
}): React.JSX.Element | null {
  const current = isAgentPermissionChoice(settings.agentPermissionDefault) ? settings.agentPermissionDefault : 'own'
  const entry = getChatPermissionSearchEntry()
  return (
    <SearchableSetting
      {...entry}
      id="chat-permissions"
      forceVisible={forceVisible}
      className="max-w-none"
    >
      <SettingsRow
        label={entry.title}
        description={entry.description}
        control={
          <NativeChatPermissionModePicker
            current={current}
            modes={AGENT_PERMISSION_CHOICES}
            onSelect={(choice) => updateSettings(applyAllAgentsPermission(settings, choice))}
          />
        }
      />
    </SearchableSetting>
  )
}
