import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type { BrowserUserAgentMode } from '../../shared/browser-user-agent-mode'
import type { GrabIntent } from '../../shared/browser-grab-types'

function subscribe<Event>(channel: string, callback: (event: Event) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, event: Event): void => callback(event)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

export const browserPageInteractionAndSessionsApi = {
  onContextMenuRequested: (callback) => subscribe('browser:context-menu-requested', callback),
  onContextMenuDismissed: (callback) => subscribe('browser:context-menu-dismissed', callback),
  onNavigationUpdate: (callback) => subscribe('browser:navigation-update', callback),
  onActivateView: (callback) => subscribe('browser:activateView', callback),
  onCapturePaintHold: (callback) => subscribe('browser:capturePaintHold', callback),
  onPaneFocus: (callback) => subscribe('browser:pane-focus', callback),
  onOpenLinkInOrcaTab: (callback) => subscribe('browser:open-link-in-orca-tab', callback),
  cancelDownload: (args) => ipcRenderer.invoke('browser:cancelDownload', args),
  setGrabMode: (args) => ipcRenderer.invoke('browser:setGrabMode', args),
  awaitGrabSelection: (args) => ipcRenderer.invoke('browser:awaitGrabSelection', args),
  cancelGrab: (args) => ipcRenderer.invoke('browser:cancelGrab', args),
  captureSelectionScreenshot: (args) =>
    ipcRenderer.invoke('browser:captureSelectionScreenshot', args),
  extractHoverPayload: (args) => ipcRenderer.invoke('browser:extractHoverPayload', args),
  onGrabModeToggle: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      browserPageId: string,
      intent: GrabIntent
    ): void => callback(browserPageId, intent)
    ipcRenderer.on('browser:grabModeToggle', listener)
    return () => ipcRenderer.removeListener('browser:grabModeToggle', listener)
  },
  onGrabActionShortcut: (callback) => subscribe('browser:grabActionShortcut', callback),
  sessionListProfiles: () => ipcRenderer.invoke('browser:session:listProfiles'),
  prepareSshWorkspacePartition: (args) =>
    ipcRenderer.invoke('browser:prepareSshWorkspacePartition', args),
  sessionCreateProfile: (args) => ipcRenderer.invoke('browser:session:createProfile', args),
  identityGet: () => ipcRenderer.invoke('browser:identity:get'),
  identitySet: (mode: BrowserUserAgentMode) => ipcRenderer.invoke('browser:identity:set', mode),
  sessionDeleteProfile: (args) => ipcRenderer.invoke('browser:session:deleteProfile', args),
  sessionImportCookies: (args) => ipcRenderer.invoke('browser:session:importCookies', args),
  sessionResolvePartition: (args) => ipcRenderer.invoke('browser:session:resolvePartition', args),
  sessionDetectBrowsers: () => ipcRenderer.invoke('browser:session:detectBrowsers'),
  sessionDetectBrowsersForClientHost: (args) =>
    ipcRenderer.invoke('browser:session:detectBrowsersForClientHost', args),
  sessionImportFromBrowser: (args) => ipcRenderer.invoke('browser:session:importFromBrowser', args),
  sessionImportFromBrowserForClientHost: (args) =>
    ipcRenderer.invoke('browser:session:importFromBrowserForClientHost', args),
  sessionClientRouteImportSources: (args) =>
    ipcRenderer.invoke('browser:session:clientRouteImportSources', args),
  sessionClearDefaultCookies: () => ipcRenderer.invoke('browser:session:clearDefaultCookies'),
  notifyActiveTabChanged: (args) => ipcRenderer.invoke('browser:activeTabChanged', args)
} satisfies Partial<PreloadApi['browser']>
