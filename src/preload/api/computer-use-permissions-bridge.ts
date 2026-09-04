import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const computerUsePermissionsApi: PreloadApi['computerUsePermissions'] = {
  getStatus: () => ipcRenderer.invoke('computerUsePermissions:getStatus'),
  openSetup: (args) => ipcRenderer.invoke('computerUsePermissions:openSetup', args),
  reset: () => ipcRenderer.invoke('computerUsePermissions:reset')
}
