import { productNameText } from '@/product-brand'
import { useEffect } from 'react'
import { worktreeActivate } from '../host-screen/host-screen-operations'
import { headlessActivationNeedsHostRenderer } from '../worktree/worktree-activation-result'
import { createInitialSessionAutoCreateState } from './use-initial-session-terminal-autocreate'
import { createEffectTimerRegistry } from './session-effect-timer-registry'
import type { MobileSessionKeyboardStateModel } from './use-mobile-session-keyboard-state'
import type { RpcResponse } from '../transport/types'

export function useMobileSessionStartup(scope: MobileSessionKeyboardStateModel) {
  const {
    hostId,
    worktreeId,
    created,
    isFloatingWorkspaceRoute,
    connState,
    client,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    appliedSnapshotMarkerRef,
    closedTabTombstonesRef,
    setTerminalsLoaded,
    setActiveHandle,
    setActiveSessionTabId,
    setMarkdownDocs,
    setFileDocs,
    terminalGestureInputQueuesRef,
    terminalGestureInputInFlightRef,
    sessionTabActionSheetKeyboardHideSubRef,
    sessionTabActionSheetRequestSeqRef,
    initializedHandlesRef,
    terminalDiagnosticsRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    pendingSelectionRef,
    selectedSessionTabIdRef,
    pendingBrowserFocusPageIdRef,
    pendingTerminalActivationAttemptRef,
    initialSessionAutoCreateRef,
    bufferedTerminalDraftState,
    clearPendingLiveInputCommit,
    clearDelayedActionTimers,
    showToast,
    clearTerminalCache,
    fetchTerminals,
    ensureSessionTabs
  } = scope
  useEffect(() => {
    // Why: Expo reuses this screen across worktrees; reset route state so it can't open stale UI or reject the next snapshot.
    sessionTabActionSheetRequestSeqRef.current += 1
    sessionTabActionSheetKeyboardHideSubRef.current?.remove()
    sessionTabActionSheetKeyboardHideSubRef.current = null
    clearTerminalCache()
    activeHandleRef.current = null
    activeSessionTabTypeRef.current = null
    pendingSelectionRef.current = null
    selectedSessionTabIdRef.current = null
    pendingBrowserFocusPageIdRef.current = null
    pendingTerminalActivationAttemptRef.current = null
    initialSessionAutoCreateRef.current = createInitialSessionAutoCreateState()
    terminalDiagnosticsRef.current.resetRoute()
    appliedSnapshotMarkerRef.current = { epoch: null, version: -1 }
    closedTabTombstonesRef.current.clear()
    bufferedTerminalDraftState.resetDrafts()
    for (const queued of terminalGestureInputQueuesRef.current.values()) {
      if (queued.timer) {
        clearTimeout(queued.timer)
      }
    }
    terminalGestureInputQueuesRef.current.clear()
    terminalGestureInputInFlightRef.current.clear()
    setActiveHandle(null)
    setTerminals([])
    terminalsRef.current = []
    setSessionTabs([])
    setActiveSessionTabId(null)
    clearPendingLiveInputCommit()
    setMarkdownDocs(new Map())
    setFileDocs(new Map())
    clearDelayedActionTimers()
    return () => {
      sessionTabActionSheetRequestSeqRef.current += 1
      sessionTabActionSheetKeyboardHideSubRef.current?.remove()
      bufferedTerminalDraftState.clearPendingRestorations()
      clearPendingLiveInputCommit()
      clearDelayedActionTimers()
    }
  }, [
    clearDelayedActionTimers,
    clearPendingLiveInputCommit,
    bufferedTerminalDraftState.clearPendingRestorations,
    clearTerminalCache,
    hostId,
    bufferedTerminalDraftState.resetDrafts,
    worktreeId
  ])

  // Every setTimeout goes through addTimer into `timers`, which the returned cleanup clears.
  // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
  useEffect(() => {
    if (connState !== 'connected') {
      return
    }
    // Why: keep the current xterm visible while the reconnect snapshot hydrates, not a blank "Loading terminals" surface.
    if (initializedHandlesRef.current.size === 0) {
      setTerminalsLoaded(false)
    }
    // Why: clear the initialized flag so the reconnect scrollback replaces stale content instead of being dropped.
    initializedHandlesRef.current.clear()
    const timerRegistry = createEffectTimerRegistry()
    void (async () => {
      // Both activations share this reader; a missing reply remains an explicit null outcome.
      const reportActivationOutcome = (response: RpcResponse | null): void => {
        const activation = response === null ? null : worktreeActivate.interpret(response)
        if (
          !timerRegistry.disposed &&
          activation?.accepted === true &&
          headlessActivationNeedsHostRenderer(activation.value)
        ) {
          showToast(productNameText('Open Orca on the host to wake sleeping agents.'), 3000)
        }
      }
      if (client && created !== '1' && !isFloatingWorkspaceRoute) {
        // Why: hydrate host-owned tabs without pulling other paired clients (esp. desktop) into this worktree.
        void worktreeActivate
          .request(client, {
            worktree: `id:${worktreeId}`,
            notifyClients: false,
            navigation: 'caller'
          })
          .then(reportActivationOutcome)
          .catch(() => null)
      }
      if (timerRegistry.disposed) {
        return
      }
      await ensureSessionTabs().catch(() => null)
      if (timerRegistry.disposed) {
        return
      }
      await fetchTerminals({ allowEmptyLoaded: false })
      if (timerRegistry.disposed) {
        return
      }
      timerRegistry.schedule(() => void fetchTerminals({ allowEmptyLoaded: false }), 750)
      timerRegistry.schedule(() => void fetchTerminals({ allowEmptyLoaded: true }), 1500)
      if (client && created === '1' && !isFloatingWorkspaceRoute) {
        timerRegistry.schedule(() => {
          if (activeHandleRef.current) {
            return
          }
          void (async () => {
            const activationResponse = await worktreeActivate
              .request(client, {
                worktree: `id:${worktreeId}`,
                notifyClients: false,
                navigation: 'caller'
              })
              .catch(() => null)
            reportActivationOutcome(activationResponse)
            if (timerRegistry.disposed) {
              return
            }
            await fetchTerminals({ allowEmptyLoaded: true })
            timerRegistry.schedule(() => void fetchTerminals({ allowEmptyLoaded: true }), 750)
          })()
        }, 1800)
      }
    })()
    return () => {
      timerRegistry.dispose()
    }
  }, [
    client,
    connState,
    created,
    fetchTerminals,
    ensureSessionTabs,
    isFloatingWorkspaceRoute,
    showToast,
    worktreeId
  ])
}
