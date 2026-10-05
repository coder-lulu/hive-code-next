import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import { CODEX_TERMINAL_SERVER_ISOLATION_SETTINGS_TARGET_ID } from '@/lib/settings-navigation-types'
import { rankSettingsSearchItems } from './settings-search'
import { getAgentsPaneSearchEntries } from './agents-search'

export type AgentsSettingsTab = 'manage' | 'preferences' | 'advanced'
export function resolveAgentsSettingsTarget(
  targetId: string,
  catalog: AgentCatalogEntry[]
): {
  tab: AgentsSettingsTab
  agent?: TuiAgent
  targetId: string
} {
  const configured = catalog.find((agent) => targetId === `agent-config-${agent.id}`)
  if (configured) {
    return { tab: 'advanced', agent: configured.id, targetId }
  }
  if (targetId === 'agent-configuration') {
    return { tab: 'advanced', targetId }
  }
  if (
    [
      'agent-status-hooks',
      'agent-tab-titles',
      'agent-awake',
      'agent-cache-timer',
      'agent-permissions',
      CODEX_TERMINAL_SERVER_ISOLATION_SETTINGS_TARGET_ID
    ].includes(targetId)
  ) {
    return { tab: 'preferences', targetId }
  }
  return { tab: 'manage', targetId }
}

export function resolveAgentsSettingsSearch(
  query: string,
  catalog: AgentCatalogEntry[],
  options: Parameters<typeof getAgentsPaneSearchEntries>[0]
) {
  if (!query.trim()) {
    return null
  }
  const ranked = rankSettingsSearchItems(
    query,
    getAgentsPaneSearchEntries(options),
    (entry) => entry
  )
  const entry = ranked[0]?.item
  return entry && 'targetSectionId' in entry && entry.targetSectionId
    ? resolveAgentsSettingsTarget(entry.targetSectionId, catalog)
    : { tab: 'manage' as const, targetId: 'agents-installed' }
}
