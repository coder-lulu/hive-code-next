import type { ManagedPane } from '@/lib/pane-manager/pane-manager-types'

/** Subscribe before refresh so cached/quiet terminals also produce a readiness frame. */
export function waitForTerminalVisibleRender(
  panes: ManagedPane[],
  onReady: () => void
): () => void {
  const rendered = new Set<number>()
  let frame: number | null = null
  let cancelled = false
  const subscriptions = panes.map((pane) =>
    pane.terminal.onRender(() => {
      rendered.add(pane.id)
      if (frame !== null || cancelled) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = null
        if (cancelled) {
          return
        }
        const visible = panes.filter((entry) => {
          const rect = entry.container.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        if (visible.length && visible.every((entry) => rendered.has(entry.id))) {
          cancelled = true
          subscriptions.forEach((subscription) => subscription.dispose())
          onReady()
        }
      })
    })
  )
  panes.forEach((pane) => pane.terminal.refresh(0, pane.terminal.rows - 1))
  return () => {
    cancelled = true
    if (frame !== null) {
      cancelAnimationFrame(frame)
    }
    subscriptions.forEach((subscription) => subscription.dispose())
  }
}
