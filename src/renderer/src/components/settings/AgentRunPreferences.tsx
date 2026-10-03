import { Info } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  applyAgentPermissionMode,
  resolveAgentPermissionModeSummary,
  type AgentPermissionMode
} from '../../../../shared/tui-agent-permissions'
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
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow
} from './SettingsFormControls'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

type AgentRunPreferencesProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

export function AgentRunPreferences(props: AgentRunPreferencesProps) {
  const { settings, updateSettings } = props
  const agentDefaultArgs = settings.agentDefaultArgs ?? {}
  const agentDefaultEnv = settings.agentDefaultEnv ?? {}
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
        <AgentPermissionsSetting
          mode={resolveAgentPermissionModeSummary({ agentDefaultArgs, agentDefaultEnv })}
          onChange={(mode) =>
            updateSettings(applyAgentPermissionMode({ mode, agentDefaultArgs, agentDefaultEnv }))
          }
        />
      </section>
    </div>
  )
}

export function AgentPermissionsSetting({
  mode,
  onChange
}: {
  mode: AgentPermissionMode
  onChange: (mode: Exclude<AgentPermissionMode, 'mixed'>) => void
}): React.JSX.Element {
  const visibleMode: Exclude<AgentPermissionMode, 'mixed'> = mode === 'manual' ? 'manual' : 'yolo'
  return (
    <section className="space-y-3">
      <SettingsSubsectionHeader
        title={
          <span className="flex items-center gap-2">
            {translate('auto.components.settings.AgentsPane.agentPermissions', 'Agent Permissions')}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={translate(
                    'auto.components.settings.AgentsPane.agentPermissionsInfo',
                    'Agent permissions info'
                  )}
                  className="grid size-5 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <Info className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {translate(
                  'auto.components.settings.AgentsPane.agentPermissionsTooltip',
                  "Doesn't apply to agents where you've overridden launch arguments."
                )}
              </TooltipContent>
            </Tooltip>
          </span>
        }
        description={translate(
          'auto.components.settings.AgentsPane.agentPermissionsDescription',
          'Choose whether Orca launches agents with fewer permission prompts or with manual checks.'
        )}
        action={
          <SettingsSegmentedControl<AgentPermissionMode>
            value={visibleMode}
            onChange={(nextMode) => {
              if (nextMode !== 'mixed') {
                onChange(nextMode)
              }
            }}
            ariaLabel={translate(
              'auto.components.settings.AgentsPane.agentPermissions',
              'Agent Permissions'
            )}
            size="sm"
            options={[
              {
                value: 'yolo',
                label: translate('auto.components.settings.AgentsPane.agentPermissionsYolo', 'Yolo')
              },
              {
                value: 'manual',
                label: translate(
                  'auto.components.settings.AgentsPane.agentPermissionsManual',
                  'Manual'
                )
              }
            ]}
          />
        }
      />
    </section>
  )
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
