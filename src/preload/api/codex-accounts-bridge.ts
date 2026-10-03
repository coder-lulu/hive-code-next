import { ipcRenderer } from 'electron'
import { CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL } from '../../shared/codex-auth-errors'
import type { PreloadApi } from '../api-types'

export const codexAccountsApi: PreloadApi['codexAccounts'] = {
  list: () => ipcRenderer.invoke('codexAccounts:list'),
  add: (args) => ipcRenderer.invoke('codexAccounts:add', args),
  cancelPendingLogin: () => ipcRenderer.invoke('codexAccounts:cancelPendingLogin'),
  getPendingLoginUrl: () => ipcRenderer.invoke('codexAccounts:pendingLoginUrl'),
  onPendingLoginUrlChanged: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string | null): void => callback(url)
    ipcRenderer.on(CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(CODEX_PENDING_LOGIN_URL_CHANGED_CHANNEL, listener)
  },
  reauthenticate: (args) => ipcRenderer.invoke('codexAccounts:reauthenticate', args),
  remove: (args) => ipcRenderer.invoke('codexAccounts:remove', args),
  select: (args) => ipcRenderer.invoke('codexAccounts:select', args),
  listStalePanes: (args) => ipcRenderer.invoke('codexAccounts:listStalePanes', args),
  listRecordedPaneLanes: (args) => ipcRenderer.invoke('codexAccounts:listRecordedPaneLanes', args),
  forgetStalePanes: (args) => ipcRenderer.invoke('codexAccounts:forgetStalePanes', args)
}
