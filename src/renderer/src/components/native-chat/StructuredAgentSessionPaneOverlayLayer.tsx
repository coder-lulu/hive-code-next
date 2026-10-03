import { HiveAgentTaskPane } from '../hive-agent/HiveAgentTaskPane'
import { memo, useCallback, useMemo, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { useActivityTerminalPortals } from '../activity/activity-terminal-portal'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import NativeChatView from './NativeChatView'
import { resolveStructuredSessionRuntimeTarget } from './structured-session-runtime-target'

type StructuredAgentSessionTab = Tab & {
  contentType: 'agent-session'
  agentSessionAgent: NonNullable<Tab['agentSessionAgent']>
}
const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

const StructuredAgentSessionOverlaySlot = memo(function StructuredAgentSessionOverlaySlot({
  tab,
  groupId,
  isActive,
  isFocusedGroup,
  sessionAnchorName,
  sessionAnchorTarget,
  target,
  onFocusOwningGroup,
  onSessionFocus,
  onSessionReady
}: {
  tab: StructuredAgentSessionTab
  groupId: string | undefined
  isActive: boolean
  isFocusedGroup: boolean
  sessionAnchorName?: string
  sessionAnchorTarget?: HTMLElement
  target: RuntimeClientTarget
  onSessionFocus?: () => void
  onSessionReady?: () => void
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}): React.JSX.Element {
  const isSessionDetail = Boolean(sessionAnchorName)
  useLayoutEffect(() => {
    if (isActive && isSessionDetail) {
      onSessionReady?.()
    }
  }, [isActive, isSessionDetail, onSessionReady])
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const stableTarget = useMemo<RuntimeClientTarget>(
    () => (environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }),
    [environmentId]
  )
  // The stable portal keeps the session controller outside an inert workbench.
  // RetainedPaneHost owns clipping, isolation and browser geometry fallback.
  return createPortal(
    <RetainedPaneHost
      groupId={isSessionDetail ? undefined : groupId}
      isVisible={isActive}
      anchorName={sessionAnchorName}
      anchorTarget={sessionAnchorTarget}
      data-structured-agent-session-overlay-tab-id={tab.id}
      onFocus={isSessionDetail ? onSessionFocus : undefined}
      onFocusOwningGroup={isSessionDetail ? undefined : onFocusOwningGroup}
    >
      <div className="native-chat-pane-shell relative z-10 flex min-h-0 min-w-0 flex-1">
        {tab.agentSessionAgent === 'hivecode' ? (
          <HiveAgentTaskPane tabId={tab.id} sessionId={tab.entityId} worktreeId={tab.worktreeId} />
        ) : (
          <NativeChatView
            mode="structured"
            tabId={tab.id}
            groupId={isSessionDetail ? undefined : groupId}
            sessionId={tab.entityId}
            agent={tab.agentSessionAgent}
            isVisible={isActive}
            isFocusedGroup={isFocusedGroup}
            target={stableTarget}
          />
        )}
      </div>
    </RetainedPaneHost>,
    document.body
  )
})

const StructuredAgentSessionPaneOverlayLayer = memo(
  function StructuredAgentSessionPaneOverlayLayer({
    worktreeId,
    isWorktreeActive
  }: {
    worktreeId: string
    isWorktreeActive: boolean
  }): React.JSX.Element {
    const {
      unifiedTabs,
      groups,
      repos,
      worktreesByRepo,
      folderWorkspaces,
      projectGroups,
      sessionsVisible,
      workbenchVisible,
      activeGroupId
    } = useAppStore(
      useShallow((state) => ({
        unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
        groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
        repos: state.repos,
        worktreesByRepo: state.worktreesByRepo,
        folderWorkspaces: state.folderWorkspaces,
        projectGroups: state.projectGroups,
        workbenchVisible: state.activeView === 'terminal' && isWorktreeActive,
        sessionsVisible: state.activeView === 'sessions',
        activeGroupId: state.activeGroupIdByWorktree[worktreeId]
      }))
    )
    const sessionPortals = useActivityTerminalPortals(sessionsVisible)
    const focusGroup = useAppStore((state) => state.focusGroup)
    const focusOwningGroup = useCallback(
      (groupId: string) => focusGroup(worktreeId, groupId),
      [focusGroup, worktreeId]
    )
    const groupActiveTabById = useMemo(
      () => new Map(groups.map((group) => [group.id, group.activeTabId] as const)),
      [groups]
    )
    const structuredTabs = useMemo(
      () =>
        unifiedTabs.flatMap((tab) => {
          if (
            tab.contentType !== 'agent-session' ||
            (tab.agentSessionAgent !== 'hivecode' &&
              !isAgentSessionHandleProvider(tab.agentSessionAgent))
          ) {
            return []
          }
          const target = resolveStructuredSessionRuntimeTarget(
            { repos, worktreesByRepo, folderWorkspaces, projectGroups },
            worktreeId,
            tab
          )
          return target ? [{ tab: tab as StructuredAgentSessionTab, target }] : []
        }),
      [unifiedTabs, repos, worktreesByRepo, folderWorkspaces, projectGroups, worktreeId]
    )
    return (
      <>
        {structuredTabs.map(({ tab, target }) => {
          const portal = sessionPortals.find(
            (entry) => entry.worktreeId === worktreeId && entry.tabId === tab.id
          )
          const isActive = Boolean(
            portal || (workbenchVisible && groupActiveTabById.get(tab.groupId) === tab.id)
          )
          return (
            <StructuredAgentSessionOverlaySlot
              key={tab.id}
              tab={tab}
              groupId={tab.groupId}
              isActive={isActive}
              isFocusedGroup={portal ? portal.active : isActive && tab.groupId === activeGroupId}
              sessionAnchorName={portal?.target.style.getPropertyValue('anchor-name') || undefined}
              sessionAnchorTarget={portal?.target}
              target={target}
              onSessionFocus={portal?.onFocus}
              onSessionReady={portal?.onReady}
              onFocusOwningGroup={focusOwningGroup}
            />
          )
        })}
      </>
    )
  }
)
export default StructuredAgentSessionPaneOverlayLayer
