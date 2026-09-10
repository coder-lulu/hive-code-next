import { memo, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import type { Tab, TabGroup } from '../../../../shared/tab-types'
import { isAgentSessionHandleProvider } from '../../../../shared/agent-session-provider-handle'
import { useAppStore } from '@/store'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import { tabGroupBodyAnchorName } from '../tab-group/tab-group-body-anchor'
import { SESSION_DETAIL_ANCHOR_NAME } from '../sessions/session-detail-anchor'
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
  isSessionDetail,
  target,
  onFocusOwningGroup
}: {
  tab: StructuredAgentSessionTab
  groupId: string | undefined
  isActive: boolean
  isSessionDetail: boolean
  target: RuntimeClientTarget
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}): React.JSX.Element {
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  // Tab metadata refreshes must not restart the chat's target-dependent effects.
  const stableTarget = useMemo<RuntimeClientTarget>(
    () => (environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }),
    [environmentId]
  )
  const anchorName = isSessionDetail
    ? SESSION_DETAIL_ANCHOR_NAME
    : groupId !== undefined
      ? tabGroupBodyAnchorName(groupId)
      : undefined
  const style = useMemo<React.CSSProperties>(
    () =>
      anchorName
        ? {
            position: 'absolute',
            positionAnchor: anchorName,
            top: `anchor(${anchorName} top)`,
            left: `anchor(${anchorName} left)`,
            width: `anchor-size(${anchorName} width)`,
            height: `anchor-size(${anchorName} height)`,
            display: isActive ? 'flex' : 'none',
            pointerEvents: isActive ? 'auto' : 'none'
          }
        : { display: 'none' },
    [anchorName, isActive]
  )
  const focusOwningGroup = useCallback(() => {
    if (!isSessionDetail && groupId !== undefined && onFocusOwningGroup) {
      onFocusOwningGroup(groupId)
    }
  }, [groupId, isSessionDetail, onFocusOwningGroup])

  // A stable portal escapes the hidden workbench without remounting the composer.
  return createPortal(
    <div
      style={style}
      className="native-chat-pane-shell z-10 min-h-0 min-w-0"
      data-structured-agent-session-overlay-tab-id={tab.id}
      aria-hidden={!isActive}
      onPointerDown={focusOwningGroup}
      onFocusCapture={focusOwningGroup}
    >
      <NativeChatView
        mode="structured"
        tabId={tab.id}
        groupId={isSessionDetail ? undefined : groupId}
        sessionId={tab.entityId}
        agent={tab.agentSessionAgent}
        isVisible={isActive}
        target={stableTarget}
      />
    </div>,
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
      selectedSessionKey,
      workbenchVisible
    } = useAppStore(
      useShallow((state) => ({
        unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
        groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
        repos: state.repos,
        worktreesByRepo: state.worktreesByRepo,
        folderWorkspaces: state.folderWorkspaces,
        projectGroups: state.projectGroups,
        workbenchVisible: state.activeView === 'terminal' && isWorktreeActive,
        selectedSessionKey:
          state.activeView === 'sessions' ? state.sessionsView.selectedSessionKey : null
      }))
    )
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
            !isAgentSessionHandleProvider(tab.agentSessionAgent)
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
        {structuredTabs.map(({ tab, target }) => (
          <StructuredAgentSessionOverlaySlot
            key={tab.id}
            tab={tab}
            groupId={tab.groupId}
            isActive={Boolean(
              selectedSessionKey === `${worktreeId}|${tab.id}` ||
              (workbenchVisible && groupActiveTabById.get(tab.groupId) === tab.id)
            )}
            isSessionDetail={selectedSessionKey === `${worktreeId}|${tab.id}`}
            target={target}
            onFocusOwningGroup={focusOwningGroup}
          />
        ))}
      </>
    )
  }
)

export default StructuredAgentSessionPaneOverlayLayer
