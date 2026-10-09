import { useCallback, useEffect, useLayoutEffect, useRef, type SetStateAction } from 'react'
import {
  CLOSE_FLOATING_TERMINAL_EVENT,
  TOGGLE_FLOATING_TERMINAL_EVENT,
  isFloatingTerminalWorkspaceId,
  requestFloatingTerminalOpenMaximized
} from '@/lib/floating-terminal'
import { createFloatingWorkspaceTourInteractionSnapshot } from '@/lib/floating-workspace-tour-interaction-snapshot'
import { persistFloatingTerminalPanelOpen } from '../components/floating-terminal/floating-terminal-panel-view-state'
import { useAppStore } from '../store'
import { selectFloatingVisibleTabCount } from '../store/selectors'
import {
  mainWorkbenchOwnsFloatingWorkspace,
  shouldMountFloatingWorkspacePanel
} from '@/lib/floating-workspace-surface-ownership'

export type FloatingWorkspacePanelState = ReturnType<typeof useFloatingWorkspacePanel>

/**
 * Drives the floating workspace overlay's open state (held in the store): persistence, the focus
 * it hands back on close, and the toggle/disable paths that can flip it from outside React.
 */
export function useFloatingWorkspacePanel() {
  const open = useAppStore((s) => s.floatingWorkspacePanelOpen)
  const setOpen = useAppStore((s) => s.setFloatingWorkspacePanelOpen)
  const tourInteractionSnapshotRef = useRef<{
    wasPreviouslyInteracted?: boolean
    persisted?: Promise<void>
    recordFeatureInteractionForTour: boolean
  } | null>(null)

  const enabled = useAppStore((s) => s.settings?.floatingTerminalEnabled === true)
  // Why tracked separately: the flag reads false while settings are still loading, and a
  // false read at boot must not be treated as the user disabling the feature. The store
  // initializes `settings` to null (not undefined) - fetchSettings replaces it atomically.
  const settingsHydrated = useAppStore((s) => s.settings != null)
  const triggerLocation = useAppStore(
    (s) => s.settings?.floatingTerminalTriggerLocation ?? 'floating-button'
  )
  const statusBarVisible = useAppStore((s) => s.statusBarVisible)
  const visibleTabCount = useAppStore(selectFloatingVisibleTabCount)
  const mainWorkspaceOwnsFloatingTabs = useAppStore((s) =>
    mainWorkbenchOwnsFloatingWorkspace(s.activeView, s.activeWorktreeId)
  )

  // Why: floating workspace is a transient overlay; hotkey minimize returns focus to the surface the user came from.
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const returnFocusFrameRef = useRef<number | null>(null)

  const cancelReturnFocusFrame = useCallback((): void => {
    if (returnFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(returnFocusFrameRef.current)
    returnFocusFrameRef.current = null
  }, [])

  const rememberReturnFocus = useCallback((): void => {
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) {
      returnFocusRef.current = null
      return
    }
    if (
      active.closest('[data-floating-terminal-panel]') ||
      active.closest('[data-floating-terminal-toggle]')
    ) {
      return
    }
    returnFocusRef.current = active
  }, [])

  const restoreReturnFocus = useCallback((): void => {
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (!target || !document.contains(target)) {
      return
    }
    cancelReturnFocusFrame()
    returnFocusFrameRef.current = requestAnimationFrame(() => {
      returnFocusFrameRef.current = null
      if (!document.contains(target)) {
        return
      }
      target.focus({ preventScroll: true })
    })
  }, [cancelReturnFocusFrame])

  const setOpenWithFocus = useCallback(
    (nextOpen: SetStateAction<boolean>): void => {
      const resolvedOpen = typeof nextOpen === 'function' ? nextOpen(open) : nextOpen
      // Why: recordFeatureInteraction updates Zustand subscribers; running it inside the state updater logs a render-phase update warning.
      if (resolvedOpen && !open) {
        const state = useAppStore.getState()
        if (isFloatingTerminalWorkspaceId(state.activeWorktreeId)) {
          // One React surface owns the synthetic workspace at a time. Opening
          // the overlay first releases the main workbench before it can mount.
          state.setActiveWorktree(null)
        }
        tourInteractionSnapshotRef.current = createFloatingWorkspaceTourInteractionSnapshot(state)
        rememberReturnFocus()
      } else if (!resolvedOpen && open) {
        restoreReturnFocus()
      }
      setOpen(resolvedOpen)
      // Why gated on the flag: `settings` is undefined until it hydrates, so the
      // feature-off effect force-closes the panel on every boot. Persisting there would
      // overwrite the user's restored `open` with a value they never chose.
      if (enabled) {
        persistFloatingTerminalPanelOpen(resolvedOpen)
      }
    },
    [enabled, open, setOpen, rememberReturnFocus, restoreReturnFocus]
  )

  const openMaximized = useCallback((): void => {
    requestFloatingTerminalOpenMaximized()
    setOpenWithFocus(true)
  }, [setOpenWithFocus])

  // Why layout: enable-then-toggle callers dispatch a frame later, which a passive rebind can miss.
  useLayoutEffect(() => {
    const toggleFloatingTerminal = (): void => {
      if (enabled) {
        setOpenWithFocus((current) => !current)
      }
    }
    const closeFloatingTerminal = (): void => setOpenWithFocus(false)
    window.addEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
    window.addEventListener(CLOSE_FLOATING_TERMINAL_EVENT, closeFloatingTerminal)
    return () => {
      window.removeEventListener(TOGGLE_FLOATING_TERMINAL_EVENT, toggleFloatingTerminal)
      window.removeEventListener(CLOSE_FLOATING_TERMINAL_EVENT, closeFloatingTerminal)
    }
  }, [enabled, setOpenWithFocus])

  useEffect(() => {
    if (mainWorkspaceOwnsFloatingTabs && open) {
      setOpenWithFocus(false)
    }
  }, [mainWorkspaceOwnsFloatingTabs, open, setOpenWithFocus])

  useEffect(() => {
    // Why the hydration gate: this effect fires on every boot while settings are still
    // undefined, and closing there discards the restored open state before the real flag
    // value arrives. Only a hydrated flag-off is an actual disable.
    if (settingsHydrated && !enabled) {
      setOpenWithFocus(false)
    }
  }, [settingsHydrated, enabled, setOpenWithFocus])

  return {
    cancelReturnFocusFrame,
    enabled,
    open,
    openMaximized,
    setOpenWithFocus,
    // Why: once the floating workspace owns tabs, keep it mounted while closed so hidden terminal/browser/editor panes retain local state.
    shouldMountPanel: shouldMountFloatingWorkspacePanel({
      enabled,
      open,
      visibleTabCount,
      mainWorkbenchOwnsWorkspace: mainWorkspaceOwnsFloatingTabs
    }),
    showToggleButton: enabled && (triggerLocation === 'floating-button' || !statusBarVisible),
    tourInteractionSnapshotRef,
    visibleTabCount
  }
}
