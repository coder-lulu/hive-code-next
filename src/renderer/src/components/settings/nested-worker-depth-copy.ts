import { translate } from '@/i18n/i18n'
import { searchKeywords } from './settings-search-keywords'

export function getNestedWorkerDepthTitle(): string {
  return translate(
    'auto.components.settings.OrchestrationPane.nestedWorkerDepthTitle',
    'Maximum child-agent spawning depth'
  )
}

export function getNestedWorkerDepthDescription(): string {
  return translate(
    'auto.components.settings.OrchestrationPane.nestedWorkerDepthDescription',
    'Global setting. At 1, child agents cannot spawn more agents. This sets nesting depth, not concurrency.'
  )
}

export function getNestedWorkerDepthSearchKeywords(): string[] {
  return searchKeywords([
    { key: 'auto.components.settings.agents.search.96ba2373b6', fallback: 'agent' },
    { key: 'auto.components.settings.general.search.ec5049e510', fallback: 'nested' },
    { key: 'agentCapabilities.nestedWorkerLegacySearch', fallback: 'nested worker' },
    { key: 'auto.components.settings.orchestration.search.741dfc03fa', fallback: 'worker' },
    { key: 'auto.components.settings.orchestration.search.eee028ae14', fallback: 'dispatch' },
    {
      key: 'auto.components.settings.orchestration.search.f5d39af41e',
      fallback: 'child agents'
    }
  ])
}
