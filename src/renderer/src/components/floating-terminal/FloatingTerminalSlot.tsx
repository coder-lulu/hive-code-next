import { useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { RetainedPaneHost } from '../tab-group/RetainedPaneHost'
import TerminalPane from '../terminal-pane/TerminalPane'
import type { TerminalPaneProps, TerminalPaneHandle } from '../terminal-pane/terminal-pane-types'
import {
  findActivityTerminalPortal,
  useActivityTerminalPortals
} from '../activity/activity-terminal-portal'

/** Keep one PTY renderer alive while its view moves between the panel and Sessions. */
export function FloatingTerminalSlot({
  paneRef,
  ...props
}: TerminalPaneProps & {
  paneRef: React.Ref<TerminalPaneHandle>
}): React.JSX.Element {
  const [panelTarget, setPanelTarget] = useState<HTMLDivElement | null>(null)
  const portals = useActivityTerminalPortals(true)
  const portal = findActivityTerminalPortal(portals, {
    worktreeId: props.worktreeId,
    tabId: props.tabId
  })
  const panelAnchor = `--floating-terminal-${props.tabId}`
  const target = portal?.target ?? panelTarget
  const anchor = portal?.target.style.getPropertyValue('anchor-name') || panelAnchor
  const visible = portal !== null || props.isVisible === true
  return (
    <>
      <div
        ref={setPanelTarget}
        className="absolute inset-0"
        style={{ anchorName: panelAnchor } as CSSProperties}
      />
      {createPortal(
        <RetainedPaneHost
          groupId={undefined}
          anchorName={anchor}
          anchorTarget={target ?? undefined}
          isVisible={visible}
          measureWhileHidden
          fitTerminal
          zIndex={portal ? undefined : 46}
          onFocus={portal?.onFocus}
          data-session-terminal={portal ? props.tabId : undefined}
        >
          <TerminalPane
            {...props}
            ref={paneRef}
            isVisible={visible}
            isActive={portal ? portal.active : props.isActive}
            onReady={portal?.onReady}
            isolatedPaneKey={portal?.paneKey || null}
          />
        </RetainedPaneHost>,
        document.body
      )}
    </>
  )
}
