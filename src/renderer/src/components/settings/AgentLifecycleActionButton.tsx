import { Download, Loader2, ArrowUp } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import type { AgentInstallationSnapshot } from './use-agent-installation'

export function AgentLifecycleActionButton({
  action,
  label,
  snapshot,
  disabled,
  officialCli,
  onClick
}: {
  action: 'install' | 'upgrade'
  label: string
  snapshot?: AgentInstallationSnapshot
  disabled?: boolean
  officialCli?: boolean
  onClick: () => void
}) {
  const upgrading = action === 'upgrade'
  const matchesAction = (snapshot?.action ?? 'install') === action
  const retrying = matchesAction && snapshot?.result && snapshot.result.status !== 'installed'
  const labels = {
    pending: upgrading
      ? translate('agentsSettings.upgrading', 'Upgrading…')
      : translate('agentsSettings.installing', 'Installing…'),
    retry: upgrading
      ? translate('agentsSettings.retryUpgrade', 'Retry upgrade')
      : translate('agentsSettings.retry', 'Retry'),
    ready: upgrading
      ? translate('agentsSettings.upgrade', 'Upgrade')
      : officialCli
        ? translate('agentsSettings.installOfficialCli', 'Install official CLI')
        : translate('agentsSettings.install', 'Install')
  }
  const actionLabel = snapshot?.installing ? labels.pending : retrying ? labels.retry : labels.ready
  return (
    <Button
      size="sm"
      onClick={onClick}
      disabled={disabled || snapshot?.hostBusy || snapshot?.installing}
      aria-busy={snapshot?.installing || undefined}
      aria-label={
        upgrading
          ? translate('agentsSettings.upgradeAgent', 'Upgrade {{agent}}', { agent: label })
          : translate('agentsSettings.installAgent', 'Install {{agent}}', { agent: label })
      }
    >
      {snapshot?.installing ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : upgrading ? (
        <ArrowUp className="size-4" />
      ) : (
        <Download className="size-4" />
      )}
      <span className="inline-grid">
        {Object.entries(labels).map(([state, reservedLabel]) => (
          <span key={state} className="invisible col-start-1 row-start-1" aria-hidden="true">
            {reservedLabel}
          </span>
        ))}
        <span className="col-start-1 row-start-1">{actionLabel}</span>
      </span>
    </Button>
  )
}
