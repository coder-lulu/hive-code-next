import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const aiVaultApi: PreloadApi['aiVault'] = {
  listSessions: (args) => ipcRenderer.invoke('aiVault:listSessions', args),
  resolveSessionTitles: (args) => ipcRenderer.invoke('aiVault:resolveSessionTitles', args),
  cancelListSessions: (args) => ipcRenderer.invoke('aiVault:cancelListSessions', args),
  prepareSessionResume: (args) => ipcRenderer.invoke('aiVault:prepareSessionResume', args),
  listSubagentSessions: (args) => ipcRenderer.invoke('aiVault:listSubagentSessions', args),
  getFirstUserPrompt: (args) => ipcRenderer.invoke('aiVault:getFirstUserPrompt', args),
  deleteSession: (args) => ipcRenderer.invoke('aiVault:deleteSession', args),
  onWindowFocused: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback()
    ipcRenderer.on('aiVault:windowFocused', listener)
    return () => ipcRenderer.removeListener('aiVault:windowFocused', listener)
  }
}
