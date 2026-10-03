import { ArrowUpRight, ExternalLink, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { AgentInstallationDetails } from './AgentInstallationDetails'
import type { AgentVersionSnapshot, AgentVersionTarget } from './agent-version-cache'
import type { AgentInstallation } from '../../../../shared/agent-installation-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { SettingsBadge } from './SettingsFormControls'
import type { AgentSessionSourceHomeControl } from './codex-session-source-home-control'
import { AgentVersionInformation, getAgentUpdateStatus } from './AgentVersionInformation'
import { AgentInstallationFeedback } from './AgentInstallationFeedback'
import type { AgentInstallationSnapshot } from './use-agent-installation'
import { AgentLifecycleActionButton } from './AgentLifecycleActionButton'

const AGENT_UPGRADE_GUIDES: Partial<Record<TuiAgent, string>> = {
  claude: 'https://code.claude.com/docs/en/setup#update-claude-code',
  codex: 'https://learn.chatgpt.com/docs/codex/cli',
  gemini: 'https://geminicli.com/docs/resources/faq/',
  pi: 'https://pi.dev/docs/latest/packages#install-and-manage',
  opencode: 'https://opencode.ai/docs/cli/#upgrade'
}

export function AgentAvailabilityControl({
  label,
  isEnabled,
  onSetEnabled
}: {
  label: string
  isEnabled: boolean
  onSetEnabled: (enabled: boolean) => void
}) {
  return (
    <Switch
      checked={isEnabled}
      onCheckedChange={(enabled) => {
        if (enabled !== isEnabled) {
          onSetEnabled(enabled)
        }
      }}
      aria-label={translate(
        'auto.components.settings.AgentsPane.1c9a9679ec',
        '{{value0}} availability',
        { value0: label }
      )}
    />
  )
}

export type AgentCatalogRowProps = {
  agentId: TuiAgent
  label: string
  homepageUrl: string
  defaultCmd: string
  defaultArgs: string
  defaultEnv: Record<string, string>
  isDetected: boolean
  isEnabled: boolean
  isDefault: boolean
  cmdOverride: string | undefined
  argsOverride: string
  envOverride: Record<string, string>
  onSetDefault: () => void
  onSetEnabled: (enabled: boolean) => void
  onSaveOverride: (value: string) => void
  onSaveArgs: (value: string) => void
  onSaveEnv: (value: Record<string, string>) => void
  sessionSourceHome?: AgentSessionSourceHomeControl
  versionSnapshot?: AgentVersionSnapshot
  onRetryVersions?: () => void
  onConfigure?: () => void
  installation?: AgentInstallationSnapshot
  onInstall?: () => void
  onUpgrade?: (installation: AgentInstallation) => void
  installDisabled?: boolean
  installationTarget?: AgentVersionTarget
}

export function AgentCatalogRow(props: AgentCatalogRowProps) {
  const [showInstallations, setShowInstallations] = useState(false)
  const {
    agentId,
    label,
    homepageUrl,
    isDetected,
    isEnabled,
    isDefault,
    onSetDefault,
    onSetEnabled,
    onConfigure,
    versionSnapshot,
    onRetryVersions,
    installation,
    onInstall,
    onUpgrade,
    installDisabled,
    cmdOverride
  } = props
  const availability = (
    <span className="inline-flex shrink-0 items-center gap-2.5">
      <AgentAvailabilityControl label={label} isEnabled={isEnabled} onSetEnabled={onSetEnabled} />
      <span className="text-[13px] leading-[18px] text-muted-foreground">
        {translate(
          isEnabled ? 'agentsSettings.enabled' : 'agentsSettings.disabled',
          isEnabled ? 'Enabled' : 'Disabled'
        )}
      </span>
    </span>
  )
  const upgradeGuideUrl = AGENT_UPGRADE_GUIDES[agentId] ?? homepageUrl
  const canUpdate =
    versionSnapshot?.current?.status === 'ready' &&
    versionSnapshot?.latest?.status === 'ready' &&
    getAgentUpdateStatus(
      versionSnapshot?.current?.version ?? null,
      versionSnapshot?.latest?.version ?? null
    ) === 'update'
  const canUpgrade =
    Boolean(onUpgrade) &&
    versionSnapshot?.current?.status === 'ready' &&
    !versionSnapshot.currentLoading &&
    !versionSnapshot.latestLoading &&
    (canUpdate || versionSnapshot?.latest?.status === 'unsupported')
  const installationDetailsToggle = props.installationTarget ? (
    <Button
      variant="ghost"
      size="sm"
      disabled={installDisabled}
      onClick={() => setShowInstallations((value) => !value)}
      aria-expanded={showInstallations}
    >
      {translate('agentsSettings.installationDetails', 'Installation details')}
    </Button>
  ) : null
  return (
    <article
      className="agent-management-card"
      data-installed={isDetected}
      id={`agent-card-${agentId}`}
      aria-label={label}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-10 shrink-0 place-items-center">
            <AgentIcon agent={agentId} size={36} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold leading-6">{label}</h4>
            {isDefault && isEnabled ? (
              <SettingsBadge tone="muted" className="border-0 px-2 text-[11px]">
                {translate('agentsSettings.default', 'Default')}
              </SettingsBadge>
            ) : null}
          </div>
        </div>
        {isDetected ? (
          availability
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{availability}</TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {translate(
                'agentsSettings.installPreferenceHint',
                'Controls whether the agent can be selected after installation. Does not install or uninstall it.'
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {isDetected ? (
        <AgentVersionInformation
          snapshot={versionSnapshot}
          onRetry={onRetryVersions ?? (() => {})}
        />
      ) : null}
      <AgentInstallationFeedback snapshot={installation} />
      {!isDetected && !onInstall ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'agentsSettings.installAutomaticUnavailable',
            'Automatic installation is unavailable for this agent. Use the installation guide.'
          )}
        </p>
      ) : null}
      {!isDetected && onInstall && cmdOverride?.trim() ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'agentsSettings.customCommandInstallHint',
            'Installs the official CLI. Your custom launch command must be updated separately.'
          )}
        </p>
      ) : null}
      <div className="agent-card-footer">
        {isDetected ? (
          <>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="px-0 pr-3 text-muted-foreground"
                onClick={onConfigure}
                aria-label={translate(
                  'agentsSettings.configureAgent',
                  'Launch configuration for {{agent}}',
                  { agent: label }
                )}
              >
                <Settings2 className="size-4" />
                {translate('agentsSettings.launchConfiguration', 'Launch configuration')}
              </Button>
              <Button variant="ghost" size="sm" className="px-2 text-muted-foreground" asChild>
                <a href={homepageUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                  {translate('agentsSettings.docs', 'Docs')}
                </a>
              </Button>
              {installationDetailsToggle}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {canUpgrade && onUpgrade ? (
                <AgentLifecycleActionButton
                  action="upgrade"
                  label={label}
                  snapshot={installation}
                  disabled={installDisabled}
                  onClick={() => setShowInstallations(true)}
                />
              ) : null}
              {canUpdate ? (
                <Button variant="outline" size="sm" className="shadow-none" asChild>
                  <a href={upgradeGuideUrl} target="_blank" rel="noopener noreferrer">
                    <ArrowUpRight className="size-4" />
                    {translate('agentsSettings.upgradeGuide', 'Upgrade guide')}
                  </a>
                </Button>
              ) : null}
              {isEnabled && !isDefault ? (
                <Button variant="outline" size="sm" className="shadow-none" onClick={onSetDefault}>
                  {translate('agentsSettings.setDefault', 'Set as default')}
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="px-0 text-muted-foreground" asChild>
              <a href={homepageUrl} target="_blank" rel="noopener noreferrer">
                {translate('agentsSettings.installGuide', 'Installation guide')}
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
            {installationDetailsToggle}
            {onInstall ? (
              <span className="ml-auto">
                <AgentLifecycleActionButton
                  action="install"
                  label={label}
                  snapshot={installation}
                  disabled={installDisabled}
                  onClick={onInstall}
                  officialCli={Boolean(cmdOverride?.trim())}
                />
              </span>
            ) : null}
          </>
        )}
      </div>
      {showInstallations && props.installationTarget ? (
        <AgentInstallationDetails
          key={JSON.stringify([props.installationTarget, cmdOverride])}
          agent={agentId}
          target={props.installationTarget}
          commandOverride={cmdOverride}
          snapshot={installation}
          disabled={installDisabled}
          onUpgrade={onUpgrade}
        />
      ) : null}
    </article>
  )
}
