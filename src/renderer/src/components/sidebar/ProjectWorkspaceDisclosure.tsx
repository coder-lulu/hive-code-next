import { ChevronRight, Folder, GitBranch } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { useProjectWorkspaceDisclosure } from './project-tree-context'
import { summarizeAgents, buildSummaryAgentGroups } from './worktree-card-agent-summary'

export function ProjectWorkspaceDisclosure({ isFolder }: { isFolder: boolean }) {
  const disclosure = useProjectWorkspaceDisclosure()
  if (!disclosure) {
    return null
  }
  const { agents, expansion } = disclosure
  const expanded = expansion.compactRootListExpanded
  const Icon = isFolder ? Folder : GitBranch
  return (
    <>
      {agents.length > 0 ? (
        <button
          type="button"
          className="project-tree-disclosure"
          aria-label={translate('components.projects.toggleSessions', 'Toggle sessions')}
          aria-expanded={expanded}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            expansion.toggleCompactRootList()
          }}
          onKeyDown={(event) => {
            if (['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
              event.stopPropagation()
              if (
                (event.key === 'ArrowLeft' && expanded) ||
                (event.key === 'ArrowRight' && !expanded)
              ) {
                event.preventDefault()
                expansion.toggleCompactRootList()
              }
            }
          }}
        >
          <ChevronRight className={expanded ? 'size-4 rotate-90' : 'size-4'} />
        </button>
      ) : (
        <span className="project-tree-disclosure" aria-hidden />
      )}
      <Icon className="size-4 shrink-0" aria-hidden />
    </>
  )
}

export function ProjectWorkspaceAgentSummary() {
  const disclosure = useProjectWorkspaceDisclosure()
  if (!disclosure || disclosure.expansion.compactRootListExpanded || !disclosure.agents.length) {
    return null
  }
  const { agents } = disclosure
  const groups = buildSummaryAgentGroups(agents)
  return (
    <span
      className="project-tree-agent-summary"
      title={summarizeAgents(
        agents,
        translate('auto.components.sidebar.WorktreeCardAgents.1b0a156717', 'Agents')
      )}
    >
      <span className="project-tree-summary-logos">
        {agents.slice(0, 3).map((agent) => (
          <AgentIcon key={agent.paneKey} agent={agentTypeToIconAgent(agent.agentType)} size={16} />
        ))}
        {agents.length > 3 && <span>+{agents.length - 3}</span>}
      </span>
      {groups.map((group) => (
        <AgentStateDot key={group.state} state={group.state} size="sm" />
      ))}
      {groups[0] && <span>{agentStateLabel(groups[0].state)}</span>}
    </span>
  )
}
