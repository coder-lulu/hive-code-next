import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const claudeAccountsApi: PreloadApi['claudeAccounts'] = {
  list: () => ipcRenderer.invoke('claudeAccounts:list'),
  add: (args) => ipcRenderer.invoke('claudeAccounts:add', args),
  cancelPendingLogin: () => ipcRenderer.invoke('claudeAccounts:cancelPendingLogin'),
  reauthenticate: (args) => ipcRenderer.invoke('claudeAccounts:reauthenticate', args),
  remove: (args) => ipcRenderer.invoke('claudeAccounts:remove', args),
  select: (args) => ipcRenderer.invoke('claudeAccounts:select', args)
}
