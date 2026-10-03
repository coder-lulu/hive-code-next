import { AlertTriangle, LoaderCircle, RefreshCw } from 'lucide-react'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { AgentCatalogRow, type AgentCatalogRowProps } from './AgentCatalogRow'

export function AgentDetectionCatalog({
  detectedAgents,
  undetectedAgents,
  detectionPending,
  detectionFailed,
  environmentUnavailable = false,
  isRefreshing,
  onRefresh,
  onCheckUpdates,
  isCheckingUpdates,
  getRowProps
}: {
  detectedAgents: AgentCatalogEntry[]
  undetectedAgents: AgentCatalogEntry[]
  detectionPending: boolean
  detectionFailed: boolean
  environmentUnavailable?: boolean
  isRefreshing: boolean
  onRefresh: () => void
  onCheckUpdates: () => void
  isCheckingUpdates: boolean
  getRowProps: (agent: AgentCatalogEntry, isDetected: boolean) => AgentCatalogRowProps
}) {
  return (
    <div className="space-y-8">
      {detectionFailed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <span className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {environmentUnavailable
              ? translate(
                  'agentsSettings.environmentUnavailable',
                  'The current environment could not be verified. Check the runtime or WSL connection and refresh detection.'
                )
              : translate(
                  'auto.components.settings.AgentsPane.remoteDetectionFailed',
                  'Couldn’t detect installed agents. Check the host connection and try again.'
                )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isRefreshing}
            onClick={onRefresh}
          >
            <RefreshCw className={cn('size-4', isRefreshing && 'animate-spin')} />
            {translate('agentsSettings.retry', 'Retry')}
          </Button>
        </div>
      ) : null}
      {detectionPending && !detectionFailed ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-settings-card border border-dashed border-border p-6 text-sm text-muted-foreground"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {translate(
            'auto.components.settings.AgentsPane.d83834f5e6',
            'Detecting installed agents…'
          )}
        </div>
      ) : null}
      {!detectionPending || detectedAgents.length > 0 ? (
        <section className="space-y-4" id="agents-installed">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h3 className="flex items-baseline gap-3 text-base font-semibold leading-6">
              {translate('agentsSettings.installed', 'Installed')}
              <span className="font-normal tabular-nums text-muted-foreground">
                {detectedAgents.length}
              </span>
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isCheckingUpdates || detectionFailed || detectedAgents.length === 0}
              onClick={onCheckUpdates}
              className="gap-2 px-0 text-muted-foreground"
            >
              <RefreshCw className={cn('size-4', isCheckingUpdates && 'animate-spin')} />
              {translate(
                isCheckingUpdates
                  ? 'agentsSettings.checkingUpdates'
                  : 'agentsSettings.checkUpdates',
                isCheckingUpdates ? 'Checking…' : 'Check for updates'
              )}
            </Button>
          </div>
          {detectedAgents.length > 0 ? (
            <div className="agents-installed-grid">
              {detectedAgents.map((agent) => (
                <AgentCatalogRow key={agent.id} {...getRowProps(agent, true)} />
              ))}
            </div>
          ) : !detectionFailed ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-settings-card border border-dashed border-border p-6 text-[13px] leading-[18px] text-muted-foreground">
              <span>
                {translate(
                  'auto.components.settings.AgentsPane.noAgentsDetected',
                  'No agents detected. If one is installed, the probe may have timed out.'
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isRefreshing}
                onClick={onRefresh}
              >
                <RefreshCw className="size-4" />
                {translate('agentsSettings.refreshDetection', 'Refresh detection')}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {undetectedAgents.length > 0 && !detectionFailed ? (
        <section className="space-y-4" id="agents-available">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="flex items-baseline gap-3 text-base font-semibold leading-6">
              {translate('agentsSettings.available', 'Available to install')}
              <span className="font-normal tabular-nums text-muted-foreground">
                {undetectedAgents.length}
              </span>
            </h3>
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              {translate('agentsSettings.notDetected', 'Not detected in the current environment')}
            </p>
          </div>
          <div className="agents-available-grid">
            {undetectedAgents.map((agent) => (
              <AgentCatalogRow key={agent.id} {...getRowProps(agent, false)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
