import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const codexAccountsApi: PreloadApi['codexAccounts'] = {
  list: () => ipcRenderer.invoke('codexAccounts:list'),
  add: (args) => ipcRenderer.invoke('codexAccounts:add', args),
  reauthenticate: (args) => ipcRenderer.invoke('codexAccounts:reauthenticate', args),
  remove: (args) => ipcRenderer.invoke('codexAccounts:remove', args),
  select: (args) => ipcRenderer.invoke('codexAccounts:select', args),
  listStalePanes: (args) => ipcRenderer.invoke('codexAccounts:listStalePanes', args),
  listRecordedPaneLanes: (args) => ipcRenderer.invoke('codexAccounts:listRecordedPaneLanes', args),
  forgetStalePanes: (args) => ipcRenderer.invoke('codexAccounts:forgetStalePanes', args)
}
