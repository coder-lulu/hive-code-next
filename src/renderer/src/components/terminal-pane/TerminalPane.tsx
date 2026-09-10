import { forwardRef, useLayoutEffect } from 'react'
import { TerminalPaneSurface } from './TerminalPaneSurface'
import { useTerminalPaneController } from './use-terminal-pane-controller'
import type { TerminalPaneHandle, TerminalPaneProps } from './terminal-pane-types'

export type { TerminalPaneHandle } from './terminal-pane-types'

function TerminalPane(
  props: TerminalPaneProps,
  ref: React.ForwardedRef<TerminalPaneHandle>
): React.JSX.Element {
  const controller = useTerminalPaneController(props, ref)
  const ready = controller.managedPanes.length > 0 || Boolean(controller.visibleTerminalError)
  const { onReady } = props
  useLayoutEffect(() => {
    if (ready) {
      onReady?.()
    }
  }, [ready, onReady])
  return <TerminalPaneSurface controller={controller} />
}

export default forwardRef(TerminalPane)
