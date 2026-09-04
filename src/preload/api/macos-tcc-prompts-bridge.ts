import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const macosTccPromptsApi: PreloadApi['macosTccPrompts'] = {
  onThreshold: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof callback>[0]
    ): void => callback(payload)
    ipcRenderer.on('macosTccPrompts:threshold', listener)
    return () => ipcRenderer.removeListener('macosTccPrompts:threshold', listener)
  },
  consumePending: () => ipcRenderer.invoke('macosTccPrompts:consumePending'),
  acknowledgePending: (claimId) =>
    ipcRenderer.invoke('macosTccPrompts:acknowledgePending', claimId),
  releasePending: (claimId) => ipcRenderer.invoke('macosTccPrompts:releasePending', claimId),
  dismiss: () => ipcRenderer.invoke('macosTccPrompts:dismiss')
}
