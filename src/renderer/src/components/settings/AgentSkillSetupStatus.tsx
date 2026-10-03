import { IntegrationStatusPill } from '../integration-status-pill'
import { SkillFreshnessStatusPill } from '../skills/SkillFreshnessStatusPill'
import { translate } from '@/i18n/i18n'

export function AgentSkillSetupStatus({
  failedExitCode,
  loading,
  installed,
  error,
  installDisabled,
  freshnessSkillName
}: {
  failedExitCode: number | null
  loading: boolean
  installed: boolean
  error: string | null
  installDisabled: boolean
  freshnessSkillName?: string
}): React.JSX.Element {
  if (failedExitCode !== null) {
    return (
      <IntegrationStatusPill tone="attention">
        {translate('auto.components.settings.AgentSkillSetupPanel.setupFailed', 'Setup failed')}
      </IntegrationStatusPill>
    )
  }
  if (loading) {
    return (
      <IntegrationStatusPill tone="neutral">
        {translate('auto.components.settings.AgentSkillSetupPanel.68a468752e', 'Checking...')}
      </IntegrationStatusPill>
    )
  }
  if (error) {
    return (
      <IntegrationStatusPill tone="attention">
        {installDisabled
          ? translate('agentCapabilities.skillUnavailable', 'Unavailable')
          : translate('agentCapabilities.skillCheckFailed', 'Check failed')}
      </IntegrationStatusPill>
    )
  }
  if (installed && freshnessSkillName) {
    return <SkillFreshnessStatusPill skillName={freshnessSkillName} />
  }
  return installed ? (
    <IntegrationStatusPill tone="connected">
      {translate('auto.components.settings.AgentSkillSetupPanel.9fcebceb2a', 'Installed')}
    </IntegrationStatusPill>
  ) : (
    <IntegrationStatusPill tone="attention">
      {translate('auto.components.settings.AgentSkillSetupPanel.5289300939', 'Not installed')}
    </IntegrationStatusPill>
  )
}
