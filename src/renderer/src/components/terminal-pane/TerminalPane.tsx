import { useLayoutEffect, useRef } from 'react'
import { TerminalPaneSurface } from './TerminalPaneSurface'
import { TerminalRestoringPlaceholder } from './TerminalRestoringPlaceholder'
import { useTerminalPaneController } from './use-terminal-pane-controller'
import { useHostTerminalScrollbackHold } from './use-host-terminal-scrollback-hold'
import type { TerminalPaneProps } from './terminal-pane-types'
import { waitForTerminalVisibleRender } from './terminal-first-visible-render'

function MountedTerminalPane(props: TerminalPaneProps): React.JSX.Element {
  const controller = useTerminalPaneController(props)
  const { onReady } = props
  const notified = useRef<typeof onReady>(undefined)
  useLayoutEffect(() => {
    if (!onReady || notified.current === onReady) {
      return
    }
    const notifyReady = (): void => {
      notified.current = onReady
      onReady()
    }
    if (controller.visibleTerminalError || controller.isChatViewMode) {
      const frame = requestAnimationFrame(notifyReady)
      return () => cancelAnimationFrame(frame)
    }
    return waitForTerminalVisibleRender(controller.managedPanes, notifyReady)
  }, [controller.managedPanes, controller.visibleTerminalError, controller.isChatViewMode, onReady])
  return <TerminalPaneSurface controller={controller} />
}

export default function TerminalPane(props: TerminalPaneProps): React.JSX.Element {
  const holdForHostScrollback = useHostTerminalScrollbackHold(props.tabId, props.worktreeId)
  return holdForHostScrollback ? (
    <TerminalRestoringPlaceholder />
  ) : (
    <MountedTerminalPane {...props} />
  )
}
