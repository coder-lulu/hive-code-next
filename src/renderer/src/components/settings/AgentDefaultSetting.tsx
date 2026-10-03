import { Terminal } from 'lucide-react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { AgentIcon, type AgentCatalogEntry } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export function AgentDefaultSetting({
  defaultAgent,
  detectedIds,
  enabledDetectedAgents,
  catalog,
  description,
  onSetDefault
}: {
  defaultAgent: TuiAgent | 'blank' | null
  detectedIds: Set<string> | null
  enabledDetectedAgents: AgentCatalogEntry[]
  catalog: AgentCatalogEntry[]
  description: string
  onSetDefault: (agent: TuiAgent | 'blank' | null) => void
}): React.JSX.Element {
  const storedDefaultAgent =
    defaultAgent && defaultAgent !== 'blank'
      ? catalog.find((agent) => agent.id === defaultAgent)
      : undefined
  const storedUnavailable =
    storedDefaultAgent && !enabledDetectedAgents.some((agent) => agent.id === defaultAgent)
  const label = translate('auto.components.settings.AgentsPane.385212c7a1', 'Default Agent')
  const storedUndetected =
    storedDefaultAgent && detectedIds !== null && !detectedIds.has(storedDefaultAgent.id)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3" id="agent-default">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-sm text-muted-foreground">{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{description}</TooltipContent>
      </Tooltip>
      <Select
        value={defaultAgent ?? 'auto'}
        onValueChange={(value) =>
          onSetDefault(value === 'auto' ? null : (value as TuiAgent | 'blank'))
        }
      >
        <SelectTrigger
          aria-label={label}
          className="max-w-full min-w-44 border-transparent shadow-none hover:bg-muted"
        >
          <SelectValue>
            {storedDefaultAgent ? (
              <AgentIcon agent={storedDefaultAgent.id} size={20} />
            ) : defaultAgent === 'blank' ? (
              <Terminal className="size-4" />
            ) : null}
            {storedDefaultAgent?.label ??
              (defaultAgent === 'blank'
                ? translate(
                    'auto.components.settings.AgentsPane.110b74b022',
                    'No agent (blank terminal)'
                  )
                : translate('auto.components.settings.AgentsPane.92033495ff', 'Auto'))}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">
            {translate('auto.components.settings.AgentsPane.92033495ff', 'Auto')}
          </SelectItem>
          <SelectItem value="blank">
            <Terminal className="size-4" />
            {translate(
              'auto.components.settings.AgentsPane.110b74b022',
              'No agent (blank terminal)'
            )}
          </SelectItem>
          {enabledDetectedAgents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              <AgentIcon agent={agent.id} size={20} />
              {agent.label}
            </SelectItem>
          ))}
          {storedUnavailable && storedDefaultAgent ? (
            <SelectItem value={storedDefaultAgent.id} disabled>
              <AgentIcon agent={storedDefaultAgent.id} size={20} />
              {storedDefaultAgent.label}
            </SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      {storedUndetected ? (
        <span className="basis-full text-[13px] leading-[18px] text-muted-foreground">
          {translate(
            'auto.components.settings.AgentsPane.storedDefaultUndetected',
            'Saved as your default, but not detected right now'
          )}
        </span>
      ) : null}
    </div>
  )
}
