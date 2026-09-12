import { memo, useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore } from '../../store'
import { isProvenProcessExit } from '../../../../shared/terminal-exit-cause'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import type { ActivityTerminalPortalTarget } from '../activity/activity-terminal-portal'
import TerminalPane from './TerminalPane'
import { SESSION_DETAIL_ANCHOR_NAME } from '../sessions/session-detail-anchor'
import { closeTerminalTab } from '../terminal/terminal-tab-actions'
import { shouldDeferParkedPtyExitTabClose } from './terminal-parked-tab-watchers'

type TerminalOverlaySlotProps = {
  terminalTabId: string
  terminalGeneration: number | undefined
  worktreeId: string
  worktreePath: string
  startupCwd: string | undefined
  groupId: string | undefined
  isWorktreeActive: boolean
  isVisible: boolean
  isActive: boolean
  activityTerminalPortal: ActivityTerminalPortalTarget | null
  onFocusOwningGroup: ((groupId: string) => void) | undefined
  consumeSuppressedPtyExit: (ptyId: string) => boolean
  leaveWorktreeIfEmpty: () => void
}

export const TerminalOverlaySlot = memo(function TerminalOverlaySlot({
  terminalTabId,
  terminalGeneration,
  worktreeId,
  worktreePath,
  startupCwd,
  groupId,
  isWorktreeActive,
  isVisible: isGroupVisible,
  isActive,
  activityTerminalPortal,
  onFocusOwningGroup,
  consumeSuppressedPtyExit,
  leaveWorktreeIfEmpty
}: TerminalOverlaySlotProps): React.JSX.Element {
  const isSessionDetail = activityTerminalPortal?.slotId.startsWith('session-detail') === true
  const isVisible = isGroupVisible || isSessionDetail
  const sessionAnchorName = isSessionDetail
    ? activityTerminalPortal?.target.style.getPropertyValue('anchor-name') ||
      SESSION_DETAIL_ANCHOR_NAME
    : undefined
  const [shouldMeasureHiddenStartup, setShouldMeasureHiddenStartup] = useState(
    () => useAppStore.getState().pendingStartupByTabId[terminalTabId] !== undefined
  )
  useLayoutEffect(() => {
    if (isVisible && shouldMeasureHiddenStartup) {
      setShouldMeasureHiddenStartup(false)
    }
  }, [isVisible, shouldMeasureHiddenStartup])

  const terminalPane = (
    <TerminalPane
      key={`${terminalTabId}-${terminalGeneration ?? 0}`}
      tabId={terminalTabId}
      worktreeId={worktreeId}
      onReady={isSessionDetail ? activityTerminalPortal?.onReady : undefined}
      cwd={startupCwd ?? worktreePath}
      isActive={
        isSessionDetail
          ? activityTerminalPortal?.active === true
          : isActive || activityTerminalPortal?.active === true
      }
      // Why: split-group changes reparent TabGroupPanel subtrees. Keeping the
      // TerminalPane mounted here preserves alt-screen TUI state while this
      // flag still lets hidden tabs throttle rendering.
      isVisible={isVisible || activityTerminalPortal !== null}
      isWorktreeActive={isWorktreeActive || activityTerminalPortal !== null}
      isolatedPaneKey={activityTerminalPortal?.paneKey || null}
      onPtyExit={(ptyId, exitCode) => {
        if (consumeSuppressedPtyExit(ptyId)) {
          return
        }
        // A synthetic host-loss exit is not evidence that the user closed the tab.
        if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
          useAppStore.getState().markUnverifiedPtyLoss(terminalTabId)
          return
        }
        // Why: a parked multi-leaf tab has no PaneManager to promote split
        // siblings, so closing the tab here would kill them; the reveal
        // remount handles dead PTYs per leaf instead.
        if (shouldDeferParkedPtyExitTabClose(terminalTabId, ptyId)) {
          return
        }
        closeTerminalTab(terminalTabId, {
          reason: 'pty-exit',
          lifecyclePtyId: ptyId,
          onClosed: leaveWorktreeIfEmpty
        })
      }}
      onCloseTab={() => {
        // Why: route through closeTerminalTab (not the raw store closeTab) so a
        // pinned tab hits the confirmation guard. The overlay's direct
        // store.closeTab was the path that closed pinned terminals silently.
        closeTerminalTab(terminalTabId, { onClosed: leaveWorktreeIfEmpty })
      }}
    />
  )

  if (activityTerminalPortal && !isSessionDetail) {
    return createPortal(
      terminalPane,
      activityTerminalPortal.target,
      `activity-terminal-${terminalTabId}`
    )
  }

  return createPortal(
    <RetainedPaneHost
      groupId={isSessionDetail ? undefined : groupId}
      anchorName={sessionAnchorName}
      anchorTarget={isSessionDetail ? activityTerminalPortal?.target : undefined}
      onFocus={isSessionDetail ? activityTerminalPortal?.onFocus : undefined}
      data-session-terminal={isSessionDetail ? terminalTabId : undefined}
      isVisible={isVisible}
      measureWhileHidden={shouldMeasureHiddenStartup}
      fitTerminal
      data-terminal-overlay-tab-id={terminalTabId}
      onFocusOwningGroup={onFocusOwningGroup}
    >
      {terminalPane}
    </RetainedPaneHost>,
    document.body
  )
})
