import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const developerPermissionsApi: PreloadApi['developerPermissions'] = {
  getStatus: () => ipcRenderer.invoke('developerPermissions:getStatus'),
  request: (args) => ipcRenderer.invoke('developerPermissions:request', args),
  openSettings: (args) => ipcRenderer.invoke('developerPermissions:openSettings', args),
  testLocalNetworkConnection: (args) =>
    ipcRenderer.invoke('developerPermissions:testLocalNetworkConnection', args)
}
