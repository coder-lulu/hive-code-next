import { AlertCircle, CheckCircle2, CircleArrowUp, LoaderCircle } from 'lucide-react'
import {
  compareAppVersions,
  isPrereleaseAppVersion,
  isValidAppVersion
} from '../../../../shared/app-version'
import { translate } from '@/i18n/i18n'
import type { AgentVersionSnapshot } from './agent-version-cache'
import { Button } from '../ui/button'
import { agentBridgeUnavailableMessage } from './agent-install-feedback'

export function getAgentUpdateStatus(current: string | null, latest: string | null) {
  if (!current || !latest || !isValidAppVersion(current) || !isValidAppVersion(latest)) {
    return 'unknown'
  }
  if (isPrereleaseAppVersion(current) !== isPrereleaseAppVersion(latest)) {
    return 'channel'
  }
  const comparison = compareAppVersions(current, latest)
  return comparison < 0 ? 'update' : comparison > 0 ? 'newer' : 'latest'
}

export function AgentVersionInformation({
  snapshot,
  onRetry
}: {
  snapshot?: AgentVersionSnapshot
  onRetry: () => void
}) {
  const status = getAgentUpdateStatus(
    snapshot?.current?.version ?? null,
    snapshot?.latest?.version ?? null
  )
  const statusCopy = {
    update: translate('agentsSettings.updateAvailable', 'Update available'),
    latest: translate('agentsSettings.upToDate', 'Up to date'),
    newer: translate('agentsSettings.newerVersion', 'Current version is newer'),
    channel: translate('agentsSettings.differentChannel', 'Different release channels'),
    unknown: ''
  }[status]
  const currentLoading = !snapshot?.current || snapshot.currentLoading
  const latestLoading = !snapshot?.latest || snapshot.latestLoading
  const sourceLabels: Record<string, string> = {
    'npm-latest': 'npm',
    'github-release': 'GitHub',
    'pypi-latest': 'PyPI'
  }
  const sourceLabel =
    snapshot?.latest &&
    (snapshot.latest.status === 'ready' || snapshot.latest.packageName || snapshot.latest.sourceUrl)
      ? sourceLabels[snapshot.latest.channel]
      : null
  const failures = [
    ...new Set(
      [snapshot?.current, snapshot?.latest]
        .filter((result) => result?.status === 'error' && result.reason)
        .map((result) => result!.reason!)
    )
  ]
  const value = (part: 'current' | 'latest') => {
    const result = snapshot?.[part]
    const loading = part === 'current' ? currentLoading : latestLoading
    if (result?.version) {
      return (
        <span className="break-all font-mono text-xl font-medium leading-7">{result.version}</span>
      )
    }
    if (loading) {
      return (
        <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {translate('agentsSettings.readingVersion', 'Reading…')}
        </span>
      )
    }
    return (
      <span className="text-sm text-muted-foreground">
        {result?.status === 'unsupported'
          ? translate('agentsSettings.unsupportedVersion', 'Not supported')
          : translate(
              part === 'current'
                ? 'agentsSettings.currentVersionFailed'
                : 'agentsSettings.latestVersionFailed',
              part === 'current' ? 'Could not read' : 'Not available'
            )}
      </span>
    )
  }
  return (
    <div className="grid grid-cols-2 gap-5" aria-live="polite">
      <div className="space-y-1 border-r border-border pr-5">
        <span className="text-[13px] leading-[18px] text-muted-foreground">
          {translate('agentsSettings.currentVersion', 'Current version')}
        </span>
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          {value('current')}
          {snapshot?.current?.status === 'error' && !currentLoading ? (
            <Button size="xs" variant="ghost" className="px-1" onClick={onRetry}>
              {translate('agentsSettings.retry', 'Retry')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-[18px] text-muted-foreground">
          <span>
            {translate('agentsSettings.latestVersion', 'Latest version')}
            {sourceLabel ? <span className="text-xs"> ({sourceLabel})</span> : null}
          </span>
          {statusCopy ? (
            <span
              className={
                status === 'update'
                  ? 'inline-flex items-center gap-1 text-status-warning'
                  : 'inline-flex items-center gap-1'
              }
            >
              {status === 'update' ? (
                <CircleArrowUp className="size-3.5" />
              ) : status === 'latest' ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <AlertCircle className="size-3.5" />
              )}
              {statusCopy}
            </span>
          ) : null}
          {snapshot?.latestLoading && snapshot.latest ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : null}
        </div>
        <div className="flex min-h-7 flex-wrap items-center gap-2">
          {value('latest')}
          {snapshot?.latest?.status === 'error' && !latestLoading ? (
            <Button size="xs" variant="ghost" className="px-1" onClick={onRetry}>
              {translate('agentsSettings.retry', 'Retry')}
            </Button>
          ) : null}
        </div>
      </div>
      {failures.length > 0 ? (
        <div className="col-span-2 space-y-1">
          {failures.map((reason) => (
            <p key={reason} role="alert" className="break-words text-xs text-destructive">
              {reason === 'bridge-unavailable'
                ? agentBridgeUnavailableMessage()
                : reason.slice(0, 512)}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
