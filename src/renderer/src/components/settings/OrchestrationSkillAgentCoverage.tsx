import { useState } from 'react'
import type { DiscoveredSkill, SkillDiscoverySource } from '../../../../shared/skills'
import type { OrchestrationSkillAgentStatus } from '@/lib/orchestration-skill-coverage'
import { AgentIcon } from '@/lib/agent-catalog'
import { useDetectedAgents, type AgentDetectionTarget } from '@/hooks/useDetectedAgents'
import { getOrchestrationSkillAgentStatuses } from '@/lib/orchestration-skill-coverage'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { ChevronRight } from 'lucide-react'

function getAgentCoverageSummary(props: {
  loading: boolean
  detectionFailed: boolean
  totalCount: number
  installedCount: number
  fullCoverage: boolean
  noCoverage: boolean
}): string {
  const { loading, detectionFailed, totalCount, installedCount, fullCoverage, noCoverage } = props

  if (detectionFailed) {
    return translate(
      'auto.components.settings.AgentsPane.remoteDetectionFailed',
      'Couldn’t detect installed agents. Check the host connection and try again.'
    )
  }
  if (loading) {
    return translate(
      'auto.components.settings.OrchestrationSkillAgentCoverage.checking',
      'Checking installed agents and skill paths…'
    )
  }
  if (totalCount === 0) {
    return translate(
      'auto.components.settings.OrchestrationSkillAgentCoverage.noAgents',
      'No agent CLIs detected on PATH. Install agents in Settings → Agents, then re-check.'
    )
  }
  if (fullCoverage) {
    return totalCount === 1
      ? translate(
          'auto.components.settings.OrchestrationSkillAgentCoverage.fullCoverage_one',
          'All 1 detected agent has the skill.'
        )
      : translate(
          'auto.components.settings.OrchestrationSkillAgentCoverage.fullCoverage_other',
          'All {{value0}} detected agents have the skill.',
          { value0: totalCount }
        )
  }
  if (noCoverage) {
    return translate(
      'auto.components.settings.OrchestrationSkillAgentCoverage.noCoverage',
      'Install the skill above, then re-check.'
    )
  }
  return translate(
    'auto.components.settings.OrchestrationSkillAgentCoverage.partialCoverage',
    '{{value0}} of {{value1}} detected agents have the skill.',
    { value0: installedCount, value1: totalCount }
  )
}

function AgentCoverageChip({
  status
}: {
  status: OrchestrationSkillAgentStatus
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
        status.installed
          ? 'border-status-success-border bg-status-success-background text-foreground'
          : 'border-border/60 bg-muted/20 text-muted-foreground'
      )}
    >
      <AgentIcon agent={status.agent} size={12} />
      <span className="font-medium text-foreground">{status.label}</span>
      <span
        className={cn(
          'text-[10px] font-medium',
          status.installed ? 'text-status-success' : 'text-muted-foreground'
        )}
      >
        {status.installed
          ? translate(
              'auto.components.settings.OrchestrationSkillAgentCoverage.1e8f8d8fae',
              'Ready'
            )
          : translate(
              'auto.components.settings.OrchestrationSkillAgentCoverage.ffe13e36fb',
              'Missing'
            )}
      </span>
    </span>
  )
}

export function OrchestrationSkillAgentCoverage(props: {
  skills: readonly DiscoveredSkill[]
  sources: readonly SkillDiscoverySource[]
  loading: boolean
  discoveryError?: string | null
  onSkillRecheck?: () => Promise<boolean>
  embedded?: boolean
  className?: string
  collapsible?: boolean
  comparable?: boolean
  detectionTarget?: AgentDetectionTarget
}): React.JSX.Element {
  const {
    skills,
    sources,
    loading: skillsLoading,
    discoveryError,
    onSkillRecheck,
    embedded = false,
    className,
    collapsible = false,
    comparable = true,
    detectionTarget = { kind: 'local' }
  } = props
  const [detailsOpen, setDetailsOpen] = useState(false)
  const {
    detectedIds,
    isLoading: agentsLoading,
    detectionFailed,
    isRefreshing,
    refresh
  } = useDetectedAgents(comparable ? detectionTarget : undefined)
  const loading = skillsLoading || agentsLoading || (detectedIds === null && !detectionFailed)
  const agentStatuses = getOrchestrationSkillAgentStatuses(skills, detectedIds ?? [], sources)
  const installedCount = agentStatuses.filter((status) => status.installed).length
  const totalCount = agentStatuses.length
  const fullCoverage =
    !loading && !detectionFailed && totalCount > 0 && installedCount === totalCount
  const noCoverage = !loading && totalCount > 0 && installedCount === 0
  const showAgentChips = !loading && totalCount > 0 && !fullCoverage
  const summary = getAgentCoverageSummary({
    loading,
    detectionFailed,
    totalCount,
    installedCount,
    fullCoverage,
    noCoverage
  })

  if (!comparable) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'agentCapabilities.coverageScopeUnavailable',
          'Agent detection and skill discovery are in different runtime scopes; coverage cannot be compared here.'
        )}
      </p>
    )
  }

  if (discoveryError && !skillsLoading) {
    return (
      <div className={cn('flex flex-wrap items-center gap-2', className)} role="alert">
        <p className="text-xs text-destructive">
          {translate(
            'agentCapabilities.coverageSkillCheckFailed',
            'Could not check skill paths; agent coverage is unavailable.'
          )}
        </p>
        {onSkillRecheck ? (
          <Button type="button" variant="ghost" size="xs" onClick={() => void onSkillRecheck()}>
            {translate('auto.components.settings.AgentSkillSetupPanel.c689392435', 'Re-check')}
          </Button>
        ) : null}
      </div>
    )
  }

  if (collapsible) {
    const compactSummary =
      loading || detectionFailed || totalCount === 0
        ? summary
        : translate(
            'agentCapabilities.coverageCount',
            '{{value0}} of {{value1}} detected agents found the orchestration skill.',
            { value0: installedCount, value1: totalCount }
          )
    return (
      <div className={className}>
        <button
          type="button"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((open) => !open)}
          className="flex w-full items-center justify-between gap-4 text-left"
        >
          <span
            role={detectionFailed ? 'alert' : undefined}
            className={cn(
              'min-w-0 text-xs',
              detectionFailed ? 'text-destructive' : 'text-muted-foreground'
            )}
          >
            {compactSummary}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-foreground">
            {translate('agentCapabilities.viewCoverageDetails', 'View details')}
            <ChevronRight
              className={cn('size-4 transition-transform', detailsOpen && 'rotate-90')}
            />
          </span>
        </button>
        {detectionFailed ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={agentsLoading || isRefreshing}
            onClick={() => void refresh()}
          >
            {translate('agentsSettings.retry', 'Retry')}
          </Button>
        ) : null}
        {detailsOpen ? (
          <div className="mt-3 divide-y divide-border/60 border-t border-border/60">
            {agentStatuses.map((status) => (
              <div
                key={status.agent}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <AgentIcon agent={status.agent} size={16} />
                  {status.label}
                </span>
                <span
                  className={status.installed ? 'text-status-success' : 'text-muted-foreground'}
                >
                  {status.installed
                    ? translate('agentCapabilities.skillFound', 'Skill found')
                    : translate('agentCapabilities.skillMissing', 'Not found')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        embedded ? 'space-y-2.5' : 'space-y-4 border-t border-border/60 pt-6',
        className
      )}
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">
          {translate(
            'auto.components.settings.OrchestrationSkillAgentCoverage.6dec5ce2d2',
            'Agent coverage'
          )}
        </h3>
        <p
          role={detectionFailed ? 'alert' : undefined}
          className={cn(
            'text-xs leading-relaxed',
            detectionFailed ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {summary}
        </p>
        {detectionFailed ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={agentsLoading || isRefreshing}
            onClick={() => void refresh()}
          >
            {translate('agentsSettings.retry', 'Retry')}
          </Button>
        ) : null}
      </div>

      {showAgentChips ? (
        <div className="flex flex-wrap gap-1.5">
          {agentStatuses.map((status) => (
            <AgentCoverageChip key={status.agent} status={status} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
