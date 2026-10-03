import { agentStateLabel, type AgentDotState } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import type { DashboardAgentRow as DashboardAgentRowData } from '@/components/dashboard/useDashboardData'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { agentRowDisplayDotState } from '@/lib/agent-row-dot-state'

export type SummaryAgentGroup = {
  state: AgentDotState
  agents: DashboardAgentRowData[]
}

const SUMMARY_STATE_ORDER: AgentDotState[] = [
  'waiting',
  'blocked',
  // Why: a failed main agent outranks live work; a pending question still comes first.
  'failed',
  'working',
  'monitoring',
  'interrupted',
  'done',
  // Why: below every reporting state, above true idle — the pane is still held.
  'unverifiable',
  'idle'
]

export function getAgentDotState(agent: DashboardAgentRowData): AgentDotState {
  return agentRowDisplayDotState(agent)
}

export function formatSummaryStateLabel(state: AgentDotState): string {
  switch (state) {
    case 'waiting':
      return translate('components.agentStatus.summaryWaiting', 'waiting')
    case 'monitoring':
      return translate('components.agentStatus.summaryMonitoring', 'monitoring')
    case 'unverifiable':
      return translate('components.agentStatus.notReporting', 'not reporting')
    case 'blocked':
    case 'interrupted':
    case 'failed':
    case 'working':
    case 'done':
    case 'idle':
    case 'permission':
      return agentStateLabel(state).toLowerCase()
  }
}

export function buildSummaryAgentGroups(agents: DashboardAgentRowData[]): SummaryAgentGroup[] {
  const groups = new Map<AgentDotState, DashboardAgentRowData[]>()
  for (const agent of agents) {
    const dotState = getAgentDotState(agent)
    const group = groups.get(dotState)
    if (group) {
      group.push(agent)
    } else {
      groups.set(dotState, [agent])
    }
  }
  return SUMMARY_STATE_ORDER.flatMap((state) => {
    const groupAgents = groups.get(state)
    return groupAgents ? [{ state, agents: groupAgents }] : []
  })
}

export function summarizeAgents(agents: DashboardAgentRowData[], subjectLabel: string): string {
  const counts = new Map<AgentDotState, number>()
  for (const agent of agents) {
    const dotState = getAgentDotState(agent)
    counts.set(dotState, (counts.get(dotState) ?? 0) + 1)
  }
  const parts = SUMMARY_STATE_ORDER.flatMap((state) => {
    const count = counts.get(state) ?? 0
    if (count === 0) {
      return []
    }
    const label = formatSummaryStateLabel(state)
    return translate('components.agentStatus.countState', '{{count}} {{state}}', {
      count,
      state: label
    })
  })
  if (parts.length === 1) {
    const onlyState = SUMMARY_STATE_ORDER.find((state) => counts.has(state))!
    const onlyStatusLabel = formatSummaryStateLabel(onlyState)
    return agents.length === 1
      ? translate('components.agentStatus.subjectState', '{{subject}} {{state}}', {
          subject: subjectLabel,
          state: onlyStatusLabel
        })
      : translate('components.agentStatus.allSubjectState', 'All {{subject}} {{state}}', {
          subject: subjectLabel,
          state: onlyStatusLabel
        })
  }
  return translate('components.agentStatus.subjectStates', '{{subject}}: {{states}}', {
    subject: subjectLabel,
    states: parts.join(', ')
  })
}

export function summarizeAgentIdentities(agents: DashboardAgentRowData[]): string {
  return agents
    .map((agent) => {
      const agentLabel = formatAgentTypeLabel(agent.agentType)
      const stateLabel = formatSummaryStateLabel(getAgentDotState(agent))
      return translate('components.agentStatus.identityState', '{{agent}} {{state}}', {
        agent: agentLabel,
        state: stateLabel
      })
    })
    .join('; ')
}

export function selectSummaryGroupIconAgents(
  agents: DashboardAgentRowData[],
  maxCount: number
): DashboardAgentRowData[] {
  const groups = new Map<string, { agents: DashboardAgentRowData[]; firstIndex: number }>()
  agents.forEach((agent, index) => {
    const key = agent.agentType ?? 'unknown'
    const group = groups.get(key)
    if (group) {
      group.agents.push(agent)
    } else {
      groups.set(key, { agents: [agent], firstIndex: index })
    }
  })
  const sortedGroups = [...groups.values()].sort(
    (a, b) => b.agents.length - a.agents.length || a.firstIndex - b.firstIndex
  )
  const selected: DashboardAgentRowData[] = []
  for (const group of sortedGroups) {
    if (selected.length >= maxCount) {
      break
    }
    selected.push(group.agents[0])
  }
  return selected
}
