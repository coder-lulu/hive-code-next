import type { AgentType } from '../../../../shared/agent-status-types'
import type { TemporarySessionItem } from '../sidebar/sidebar-session-model'
import type { SessionListStatus } from '../sidebar/session-list-status'

/** A read-only projection of the current restorable inventory, never a session store. */
export type SessionListItem = Omit<TemporarySessionItem, 'status'> & {
  key: string
  kind: 'terminal' | 'structured'
  providerSessionId: string | null
  agent: AgentType | null
  groupId: string | null
  projectKey: string | null
  projectLabel: string | null
  workspaceLabel: string | null
  workspacePath: string | null
  hostLabel: string
  status: SessionListStatus
}

export type SessionProjectOption = { key: string; label: string; hostLabel: string }
