import { app, type BrowserWindow } from 'electron'
import { isPairingProtocolUrl, registerProtocolHandlers } from './protocol-handler'
import { mainProcessState as state } from './main-process-state'

export function capturePairingProtocolUrl(argv: readonly string[]): void {
  const url = argv.find(isPairingProtocolUrl)
  if (!url) {
    return
  }
  state.pendingProtocolUrl = url
  const window = state.mainWindow
  if (
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    !window.webContents.isLoadingMainFrame()
  ) {
    publishPendingPairingProtocolUrl(window)
  }
}

export function publishPendingPairingProtocolUrl(window: BrowserWindow): void {
  if (!state.pendingProtocolUrl || window.isDestroyed() || window.webContents.isDestroyed()) {
    return
  }
  window.webContents.send('protocol:pairing-url', state.pendingProtocolUrl)
  state.pendingProtocolUrl = null
}

export function registerPairingProtocols(): void {
  // The entry point captures cold macOS URLs before ready; avoid registering a second consumer.
  registerProtocolHandlers({
    app,
    onUrl: (url) => capturePairingProtocolUrl([url]),
    listenForOpenUrl: false
  })
}
