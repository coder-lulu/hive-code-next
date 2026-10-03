import type { AppState } from '../types'
import type {
  PathSource,
  ShellHydrationFailureReason
} from '../../../../shared/shell-path-hydration-types'
import type { TuiAgent } from '../../../../shared/tui-agent'

export type LocalDetectedAgentState = {
  detectedAgentIds: TuiAgent[] | null
  isDetectingAgents: boolean
  isRefreshingAgents: boolean
  didAgentDetectionFail: boolean
  localDetectedAgentIdsByContext: Record<string, TuiAgent[] | null>
  isDetectingLocalAgentsByContext: Record<string, boolean>
  isRefreshingLocalAgentsByContext: Record<string, boolean>
  didLocalAgentDetectionFailByContext: Record<string, boolean>
  pathSource: PathSource | null
  pathFailureReason: ShellHydrationFailureReason | null
  ensureDetectedAgents: (worktreeId?: string | null) => Promise<TuiAgent[]>
  refreshDetectedAgents: (worktreeId?: string | null) => Promise<TuiAgent[]>
  clearLocalDetectedAgentContextsForProjects: (projectIds: readonly string[]) => void
  clearLocalDetectedAgents: () => void
}

export function createEmptyLocalDetectedAgentState(): Pick<
  AppState,
  | 'detectedAgentIds'
  | 'isDetectingAgents'
  | 'isRefreshingAgents'
  | 'didAgentDetectionFail'
  | 'localDetectedAgentIdsByContext'
  | 'isDetectingLocalAgentsByContext'
  | 'isRefreshingLocalAgentsByContext'
  | 'didLocalAgentDetectionFailByContext'
  | 'pathSource'
  | 'pathFailureReason'
> {
  return {
    detectedAgentIds: null,
    isDetectingAgents: false,
    isRefreshingAgents: false,
    didAgentDetectionFail: false,
    localDetectedAgentIdsByContext: {},
    isDetectingLocalAgentsByContext: {},
    isRefreshingLocalAgentsByContext: {},
    didLocalAgentDetectionFailByContext: {},
    pathSource: null,
    pathFailureReason: null
  }
}
