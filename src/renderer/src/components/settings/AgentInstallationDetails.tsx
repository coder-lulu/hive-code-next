import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type {
  AgentInstallation,
  AgentInstallationReport
} from '../../../../shared/agent-installation-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import type { AgentVersionTarget } from './agent-version-cache'
import type { AgentInstallationSnapshot } from './use-agent-installation'
import { agentInstallFailureMessage } from './agent-install-feedback'

export function AgentInstallationDetails({
  agent,
  target,
  commandOverride,
  snapshot,
  disabled,
  onUpgrade
}: {
  agent: TuiAgent
  target: AgentVersionTarget
  commandOverride?: string
  snapshot?: AgentInstallationSnapshot
  disabled?: boolean
  onUpgrade?: (installation: AgentInstallation) => void
}) {
  const [report, setReport] = useState<AgentInstallationReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const { environmentId, wslDistro } = target
  useEffect(() => {
    let active = true
    setReport(null)
    if (disabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    const request = { agent, commandOverride, wslDistro }
    const operation = Promise.resolve().then(() =>
      environmentId
        ? callRuntimeRpc<AgentInstallationReport>(
            { kind: 'environment', environmentId },
            'preflight.readAgentInstallations',
            request,
            { timeoutMs: 120_000 }
          )
        : window.api.preflight.readAgentInstallations(request)
    )
    void operation
      .catch((): AgentInstallationReport => ({
        status: 'error',
        installations: [],
        conflict: false,
        truncated: false,
        reason: 'environment-unverifiable'
      }))
      .then((result) => {
        if (active) {
          setReport(result)
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [agent, environmentId, wslDistro, commandOverride, revision, snapshot?.result, disabled])

  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-label={translate('agentsSettings.installationDetails', 'Installation details')}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {translate('agentsSettings.installationDetails', 'Installation details')}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={loading || disabled || snapshot?.hostBusy}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
          {translate('agentsSettings.refreshDetection', 'Refresh detection')}
        </Button>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate(
            'agentsSettings.inspectingInstallations',
            'Checking installation paths and versions…'
          )}
        </p>
      ) : null}
      {disabled || report?.status === 'error' || report?.status === 'unsupported' ? (
        <p role="alert" className="text-sm text-destructive">
          {agentInstallFailureMessage(report?.reason ?? 'environment-unverifiable', 'upgrade')}
        </p>
      ) : null}
      {report?.conflict ? (
        <p role="status" className="text-sm text-status-warning">
          {translate(
            'agentsSettings.installationConflict',
            'Multiple installations have different versions or health. Only the selected installation will be upgraded.'
          )}
        </p>
      ) : null}
      {report?.status === 'ready' && report.installations.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'agentsSettings.noInstallations',
            'No installation paths were found in this environment.'
          )}
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {report?.installations.map((installation) => (
          <li key={installation.realPath} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>
                {installation.source === 'unknown'
                  ? translate('agentsSettings.unknownInstallSource', 'Unverified source')
                  : installation.source}
              </span>
              {installation.isActive ? (
                <span className="font-medium text-foreground">
                  {translate('agentsSettings.activeInstallation', 'Used by HiveCode')}
                </span>
              ) : null}
              {installation.isDefault ? (
                <span>{translate('agentsSettings.defaultInstallation', 'Default command')}</span>
              ) : null}
              <span>
                {installation.version ??
                  translate('agentsSettings.brokenInstallation', 'Unable to run')}
              </span>
            </div>
            <p className="break-all font-mono text-xs">{installation.path}</p>
            {installation.realPath !== installation.path ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                {installation.realPath}
              </p>
            ) : null}
            {!installation.canUpgrade || !onUpgrade ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'agentsSettings.installationNeedsAttention',
                  'Automatic upgrade is unavailable. Check this installation using its original installer or upgrade guide.'
                )}
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || snapshot?.hostBusy || loading}
                onClick={() => onUpgrade(installation)}
              >
                {translate('agentsSettings.upgradeInstallation', 'Upgrade this installation')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {snapshot?.installing ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('agentsSettings.upgrading', 'Upgrading…')}
        </p>
      ) : null}
      {report?.truncated ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'agentsSettings.installationsTruncated',
            'The bounded scan reached its limit. Additional installations may exist.'
          )}
        </p>
      ) : null}
    </section>
  )
}
