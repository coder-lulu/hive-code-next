import type { ManagedPaneInternal } from './pane-manager-types'

const pending = new Map<ManagedPaneInternal, () => void>()
let frame: number | null = null
let task: ReturnType<typeof setTimeout> | null = null

function scheduleNext(): void {
  if (!pending.size || frame !== null || task !== null) {
    return
  }
  frame = requestAnimationFrame(() => {
    frame = null
    // Leave a paint opportunity before each pane's GPU initialization.
    task = setTimeout(() => {
      task = null
      const next = pending.entries().next().value
      if (!next) {
        return
      }
      const [pane, attach] = next
      pending.delete(pane)
      try {
        attach()
      } finally {
        scheduleNext()
      }
    }, 0)
  })
}

export function queueInitialPaneWebgl(pane: ManagedPaneInternal, attach: () => void): void {
  pending.set(pane, attach)
  scheduleNext()
}

export function isInitialPaneWebglPending(pane: ManagedPaneInternal): boolean {
  return pending.has(pane)
}

export function cancelInitialPaneWebgl(pane: ManagedPaneInternal): void {
  pending.delete(pane)
  if (pending.size) {
    return
  }
  if (frame !== null) {
    cancelAnimationFrame(frame)
  }
  if (task !== null) {
    clearTimeout(task)
  }
  frame = null
  task = null
}
