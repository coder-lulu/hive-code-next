import { forwardRef, useLayoutEffect, useRef } from 'react'
import { TerminalPaneSurface } from './TerminalPaneSurface'
import { useTerminalPaneController } from './use-terminal-pane-controller'
import type { TerminalPaneHandle, TerminalPaneProps } from './terminal-pane-types'
import { waitForTerminalVisibleRender } from './terminal-first-visible-render'

export type { TerminalPaneHandle } from './terminal-pane-types'

function TerminalPane(
  props: TerminalPaneProps,
  ref: React.ForwardedRef<TerminalPaneHandle>
): React.JSX.Element {
  const controller = useTerminalPaneController(props, ref)
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

export default forwardRef(TerminalPane)
