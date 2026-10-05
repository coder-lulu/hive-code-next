import { useEffect, useRef, useState } from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { isPairedWebClientWindow } from '@/lib/desktop-window-chrome'
import {
  resolveAgentsSettingsSearch,
  resolveAgentsSettingsTarget,
  type AgentsSettingsTab
} from './agents-settings-navigation'

export function useAgentsSettingsNavigation(
  catalog: AgentCatalogEntry[],
  defaultAgent: TuiAgent | 'blank' | null,
  wslSupportedPlatform?: boolean
) {
  const searchQuery = useAppStore((state) => state.settingsSearchQuery)
  const requestedTarget = useAppStore((state) => state.settingsNavigationTarget)
  const isWebClient = isPairedWebClientWindow()
  const [navigation, setNavigation] = useState({
    tab: 'manage' as AgentsSettingsTab,
    agent: defaultAgent && defaultAgent !== 'blank' ? defaultAgent : catalog[0].id,
    query: '',
    request: null as typeof requestedTarget,
    focusTarget: '',
    focusHeading: false,
    focusRevision: 0
  })
  const focusRoot = useRef<HTMLDivElement>(null)
  if (navigation.query !== searchQuery || navigation.request !== requestedTarget) {
    const target =
      requestedTarget?.pane === 'agents' && requestedTarget.sectionId
        ? resolveAgentsSettingsTarget(requestedTarget.sectionId, catalog)
        : navigation.query !== searchQuery
          ? resolveAgentsSettingsSearch(searchQuery, catalog, {
              includeAgentAwake: !isWebClient,
              includeAgentRuntime: wslSupportedPlatform,
              includeAgentWorkspaceTrust: !isWebClient,
              includeCodexTerminalServerIsolation: !isWebClient
            })
          : null
    setNavigation({
      ...navigation,
      query: searchQuery,
      request: requestedTarget,
      ...(target
        ? {
            tab: target.tab,
            agent: target.agent ?? navigation.agent,
            focusTarget: target.targetId,
            focusHeading: Boolean(requestedTarget?.pane === 'agents' && requestedTarget.sectionId),
            focusRevision: navigation.focusRevision + 1
          }
        : {})
    })
  }
  useEffect(() => {
    if (!navigation.focusTarget) {
      return
    }
    const element = focusRoot.current?.querySelector<HTMLElement>(
      navigation.tab === 'advanced'
        ? `[data-agent-config-heading="${navigation.agent}"]`
        : `[id="${navigation.focusTarget}"]`
    )
    element?.scrollIntoView?.({ block: 'nearest' })
    if (navigation.tab === 'advanced' && navigation.focusHeading) {
      element?.focus()
    }
  }, [
    navigation.focusRevision,
    navigation.focusTarget,
    navigation.focusHeading,
    navigation.tab,
    navigation.agent
  ])
  const openConfiguration = (agent: TuiAgent) =>
    setNavigation({
      ...navigation,
      tab: 'advanced',
      agent,
      focusTarget: `agent-config-${agent}`,
      focusHeading: true,
      focusRevision: navigation.focusRevision + 1
    })

  return { navigation, setNavigation, focusRoot, openConfiguration }
}
