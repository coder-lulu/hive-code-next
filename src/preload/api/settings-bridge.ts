import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const settingsApi: PreloadApi['settings'] = {
  get: () => ipcRenderer.invoke('settings:get'),

  // Why: blocking read for the few startup decisions (terminal side-effect authority) that can't wait for async hydration. Call sparingly.
  getSync: () => ipcRenderer.sendSync('settings:get-sync'),

  set: (args) => ipcRenderer.invoke('settings:set', args),

  setActiveRuntimeEnvironmentPreference: (args) =>
    ipcRenderer.invoke('settings:set-active-runtime-environment-preference', args),

  updatePRBotAuthorOverride: (args) =>
    ipcRenderer.invoke('settings:update-pr-bot-author-override', args),

  listFonts: () => ipcRenderer.invoke('settings:listFonts'),

  previewGhosttyImport: () => ipcRenderer.invoke('settings:previewGhosttyImport'),

  previewWarpThemeImport: (source) => ipcRenderer.invoke('settings:previewWarpThemeImport', source),

  onChanged: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      updates: Parameters<typeof callback>[0]
    ): void => callback(updates)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
}
