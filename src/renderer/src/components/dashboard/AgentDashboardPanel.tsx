import { useCallback } from 'react'
import type { AgentSubjectReadIntent } from '@/attention/agent-subject-read-actions'
import { useAppStore } from '@/store'
import { AgentKanbanBoard, type AgentBoardViewState } from '../dashboard-popout/AgentKanbanBoard'
import type { AgentRevealArgs } from '../dashboard-popout/AgentTerminalDialog'
import { useLiveDashboardSnapshot } from './useLiveDashboardSnapshot'
import { revealDashboardAgent } from './reveal-dashboard-agent'

export default function AgentDashboardPanel({
  onClose,
  viewState,
  onViewStateChange
}: {
  onClose: () => void
  viewState: AgentBoardViewState
  onViewStateChange: (state: AgentBoardViewState) => void
}): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const onAckAgent = useCallback((paneKey: string, intent: AgentSubjectReadIntent) => {
    useAppStore.getState().acknowledgeAgents([paneKey], undefined, intent)
  }, [])
  const onRevealAgent = useCallback(
    (args: AgentRevealArgs) => {
      if (revealDashboardAgent(args)) {
        onClose()
      }
    },
    [onClose]
  )
  return (
    <AgentKanbanBoard
      snapshot={snapshot}
      showHeader={false}
      containerClassName="h-full w-full bg-transparent"
      onAckAgent={onAckAgent}
      onRevealAgent={onRevealAgent}
      onClose={onClose}
      viewState={viewState}
      onViewStateChange={onViewStateChange}
    />
  )
}
