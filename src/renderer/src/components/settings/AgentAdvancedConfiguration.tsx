import { ExternalLink } from 'lucide-react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { AgentIcon, type AgentCatalogEntry } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { AgentCatalogRowProps } from './AgentCatalogRow'
import {
  AgentCommandOverrideInput,
  AgentDefaultArgsInput,
  AgentDefaultEnvInput
} from './AgentLaunchDefaultsEditor'
import { AgentSessionSourceHomeInput } from './codex-session-source-home-control'
import { stringifyAgentDefaultEnvDraft } from './agent-default-env-draft'

export function AgentAdvancedConfiguration({
  catalog,
  detectedIds,
  selectedAgent,
  onSelectAgent,
  environmentLabel,
  getRowProps
}: {
  catalog: AgentCatalogEntry[]
  detectedIds: Set<string> | null
  selectedAgent: TuiAgent
  onSelectAgent: (agent: TuiAgent) => void
  environmentLabel: string
  getRowProps: (agent: AgentCatalogEntry, isDetected: boolean) => AgentCatalogRowProps
}) {
  const selected = catalog.find((agent) => agent.id === selectedAgent)!
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <Select value={selectedAgent} onValueChange={(value) => onSelectAgent(value as TuiAgent)}>
            <SelectTrigger
              aria-label={translate('agentsSettings.selectAgent', 'Choose an agent')}
              className="min-w-52 shadow-none"
            >
              <SelectValue>
                <AgentIcon agent={selectedAgent} size={20} />
                {selected.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {catalog.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  <AgentIcon agent={agent.id} size={20} />
                  {agent.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[13px] leading-[18px] text-muted-foreground">
            {environmentLabel}
          </span>
        </div>
        <Button variant="ghost" asChild>
          <a href={selected.homepageUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            {translate('agentsSettings.docs', 'Docs')}
          </a>
        </Button>
      </div>
      {catalog.map((agent) => {
        const props = getRowProps(agent, detectedIds?.has(agent.id) === true)
        const canEditCommand = props.isDetected || Boolean(props.cmdOverride?.trim())
        const envSummary = stringifyAgentDefaultEnvDraft(props.envOverride)
        const defaultEnvSummary = stringifyAgentDefaultEnvDraft(props.defaultEnv)
        return (
          <section
            key={agent.id}
            hidden={agent.id !== selectedAgent}
            className="space-y-6 border-t border-border pt-6"
            id={`agent-config-${agent.id}`}
          >
            <h3
              tabIndex={-1}
              className="text-base font-semibold leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-agent-config-heading={agent.id}
            >
              {translate('agentsSettings.configurationTitle', '{{agent}} launch configuration', {
                agent: agent.label
              })}
            </h3>
            {canEditCommand ? (
              <AgentCommandOverrideInput
                key={props.cmdOverride ?? props.defaultCmd}
                defaultCmd={props.defaultCmd}
                cmdOverride={props.cmdOverride}
                onSaveOverride={props.onSaveOverride}
              />
            ) : null}
            {props.isDetected ? (
              <>
                <AgentDefaultArgsInput
                  key={props.argsOverride}
                  defaultArgs={props.defaultArgs}
                  argsOverride={props.argsOverride}
                  onSaveArgs={props.onSaveArgs}
                />
                {defaultEnvSummary || envSummary ? (
                  <AgentDefaultEnvInput
                    key={envSummary}
                    defaultEnv={props.defaultEnv}
                    envOverride={props.envOverride}
                    onSaveEnv={props.onSaveEnv}
                  />
                ) : null}
                {props.sessionSourceHome ? (
                  <AgentSessionSourceHomeInput
                    key={`${props.sessionSourceHome.runtimeLabel}:${props.sessionSourceHome.value}`}
                    {...props.sessionSourceHome}
                  />
                ) : null}
              </>
            ) : (
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                {translate(
                  canEditCommand
                    ? 'agentsSettings.notDetected'
                    : 'agentsSettings.configurationUnavailable',
                  canEditCommand
                    ? 'Not detected in the current environment'
                    : 'This agent has not been detected in the current environment. Install it and refresh detection to configure its launch.'
                )}
              </p>
            )}
            {canEditCommand ? (
              <p className="text-[13px] leading-[18px] text-muted-foreground">
                {translate(
                  'agentsSettings.saveHint',
                  'Changes are saved on blur or Enter. Escape restores the saved value.'
                )}
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
