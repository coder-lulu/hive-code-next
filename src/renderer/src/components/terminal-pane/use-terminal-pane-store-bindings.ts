import { useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../../store'
import { useLinkRoutingPreferenceDialog } from '@/components/link-routing-preference-dialog-context'
import { isWindowsUserAgent } from './pane-helpers'
import type { SessionRestoredBannerReason } from './session-restored-banner-pane-state'
import { useTerminalPaneStoreActions } from './use-terminal-pane-store-actions'
import type { TerminalPaneChatController } from './use-terminal-pane-chat-state'

export function useTerminalPaneStoreBindings(controller: TerminalPaneChatController) {
  const { expectedLayoutLeafIds, isVisible, measureWhileHidden, restoredLayout, tabId } = controller
  const {
    clearRuntimePaneTitle,
    clearTabPtyId,
    consumeTabIssueCommandSplit,
    consumeTabStartupCommand,
    markTerminalBell,
    openSpacePage,
    refreshWorkspaceSpace,
    setRuntimePaneTitle,
    setTabLayout,
    setTabLocalOnlyScrollback,
    updateSettings,
    updateTabPtyId,
    updateTabTitle
  } = useTerminalPaneStoreActions()
  const expectedLayoutLeafIdsAttr =
    expectedLayoutLeafIds.length > 0 ? expectedLayoutLeafIds.join(' ') : undefined
  const initialLayoutRef = useRef(restoredLayout)
  const { settings, keybindings } = useAppStore(
    useShallow((store) => ({ settings: store.settings, keybindings: store.keybindings }))
  )
  const requestLinkRoutingPreference = useLinkRoutingPreferenceDialog()
  const rightClickToPaste = settings?.terminalRightClickToPaste ?? isWindowsUserAgent()
  const forceBracketedMultilineTextPaste = isWindowsUserAgent()
  const [startup] = useState(() => useAppStore.getState().pendingStartupByTabId[tabId])
  const [shouldMeasureHiddenStartupState, setShouldMeasureHiddenStartup] = useState(
    () => startup !== undefined && !isVisible
  )
  const shouldMeasureHiddenStartup =
    shouldMeasureHiddenStartupState || (measureWhileHidden === true && !isVisible)
  const [sessionRestoredBannerPaneIds, setSessionRestoredBannerPaneIds] = useState<
    Map<number, SessionRestoredBannerReason>
  >(() => new Map())
  const [issueCommandSplit] = useState(
    () => useAppStore.getState().pendingIssueCommandSplitByTabId[tabId]
  )

  return {
    setTabLayout,
    setTabLocalOnlyScrollback,
    expectedLayoutLeafIdsAttr,
    initialLayoutRef,
    updateTabTitle,
    setRuntimePaneTitle,
    clearRuntimePaneTitle,
    updateTabPtyId,
    clearTabPtyId,
    markTerminalBell,
    openSpacePage,
    refreshWorkspaceSpace,
    settings,
    updateSettings,
    requestLinkRoutingPreference,
    keybindings,
    rightClickToPaste,
    forceBracketedMultilineTextPaste,
    startup,
    shouldMeasureHiddenStartup,
    setShouldMeasureHiddenStartup,
    sessionRestoredBannerPaneIds,
    setSessionRestoredBannerPaneIds,
    consumeTabStartupCommand,
    issueCommandSplit,
    consumeTabIssueCommandSplit
  }
}

export type TerminalPaneStoreController = TerminalPaneChatController &
  ReturnType<typeof useTerminalPaneStoreBindings>
