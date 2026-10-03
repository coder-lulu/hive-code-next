import type { AppState } from '../types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { removeLocalAgentContextEntry } from './local-agent-context-eviction'

export function getLocalAgentProbeResultPatch(
  state: AppState,
  contextKey: string,
  phase: 'detect' | 'refresh',
  ids: TuiAgent[] | null,
  failed: boolean,
  exposeToLegacy: boolean
): Partial<AppState> {
  const loadingKey = phase === 'detect' ? 'isDetectingAgents' : 'isRefreshingAgents'
  const contextLoadingKey =
    phase === 'detect' ? 'isDetectingLocalAgentsByContext' : 'isRefreshingLocalAgentsByContext'
  return {
    ...(exposeToLegacy
      ? { detectedAgentIds: ids, didAgentDetectionFail: failed, [loadingKey]: false }
      : {}),
    localDetectedAgentIdsByContext: { ...state.localDetectedAgentIdsByContext, [contextKey]: ids },
    didLocalAgentDetectionFailByContext: failed
      ? { ...state.didLocalAgentDetectionFailByContext, [contextKey]: true }
      : removeLocalAgentContextEntry(state.didLocalAgentDetectionFailByContext, contextKey),
    [contextLoadingKey]: removeLocalAgentContextEntry(state[contextLoadingKey], contextKey)
  }
}
