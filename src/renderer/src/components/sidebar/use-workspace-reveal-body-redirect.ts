import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT,
  WORKSPACE_REVEAL_LIST_READY_EVENT
} from '@/lib/scroll-to-current-workspace-status'

/** Replay only after the lazy project tree registers its reveal listener. */
export function useWorkspaceRevealBodyRedirect(): void {
  const pending = useRef<{ detail: unknown } | null>(null)
  useEffect(() => {
    const onRequest = (event: Event) => {
      const state = useAppStore.getState()
      if (
        state.sessionsView.navigation === 'projects' &&
        (state.activeView === 'sessions' ||
          (state.activeView === 'terminal' && state.activeWorktreeId))
      ) {
        return
      }
      pending.current = { detail: event instanceof CustomEvent ? event.detail : undefined }
      state.updateSessionsView({ navigation: 'projects' })
      if (state.activeView !== 'terminal' || !state.activeWorktreeId) {
        state.openSessionsPage()
      }
    }
    const onReady = () => {
      const request = pending.current
      if (!request) {
        return
      }
      pending.current = null
      window.dispatchEvent(
        new CustomEvent(SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT, {
          detail: request.detail
        })
      )
    }
    window.addEventListener(SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT, onRequest)
    window.addEventListener(WORKSPACE_REVEAL_LIST_READY_EVENT, onReady)
    return () => {
      window.removeEventListener(SCROLL_TO_CURRENT_WORKSPACE_REVEAL_REQUEST_EVENT, onRequest)
      window.removeEventListener(WORKSPACE_REVEAL_LIST_READY_EVENT, onReady)
    }
  }, [])
}
