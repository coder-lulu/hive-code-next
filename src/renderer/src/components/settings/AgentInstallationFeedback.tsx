import { CheckCircle2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { agentInstallFailureMessage } from './agent-install-feedback'
import type { AgentInstallationSnapshot } from './use-agent-installation'

export function AgentInstallationFeedback({ snapshot }: { snapshot?: AgentInstallationSnapshot }) {
  const result = snapshot?.result
  const upgrading = snapshot?.action === 'upgrade'
  if (!result || snapshot.installing) {
    return null
  }
  if (result.status === 'installed') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0" />
        {upgrading
          ? result.previousVersion === result.version
            ? translate('agentsSettings.upToDate', 'Up to date')
            : translate('agentsSettings.upgradeSucceeded', 'Upgraded')
          : translate('agentsSettings.installSucceeded', 'Installed')}
        {upgrading && result.previousVersion ? (
          <span className="font-mono">{result.previousVersion} →</span>
        ) : null}
        {result.version ? <span className="font-mono">{result.version}</span> : null}
        {result.command ? (
          <span className="break-all font-mono text-xs">{result.command}</span>
        ) : null}
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <p role="alert" className="break-words text-sm text-destructive">
        {agentInstallFailureMessage(result.reason, upgrading ? 'upgrade' : 'install')}
      </p>
      {result.output ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {upgrading
              ? translate('agentsSettings.upgradeOutput', 'Upgrade output')
              : translate('agentsSettings.installOutput', 'Installation output')}
          </summary>
          <pre className="scrollbar-sleek mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono">
            {result.output.slice(-4096)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}
