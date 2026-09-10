import type { ExecutionHostId } from './execution-host'

/** Navigation filters only; execution ownership remains on the session. */
export type SessionListScope =
  | { kind: 'all' }
  | { kind: 'unassigned' }
  | { kind: 'project'; projectKey: string; workspaceKey?: string }
  | { kind: 'workspace'; workspaceKey: string; executionHostId: ExecutionHostId }

export type SessionListViewState = {
  navigation?: 'sessions' | 'projects'
  scope: SessionListScope
  query: string
  selectedSessionKey: string | null
  scrollTop: number
}
