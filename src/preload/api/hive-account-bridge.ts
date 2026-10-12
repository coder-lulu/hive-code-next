import { ipcRenderer } from 'electron'
import {
  HIVE_ACCOUNT_STATE_CHANGED_CHANNEL,
  type HiveAccountState
} from '../../shared/hive-account'
import type { HiveAccountApi } from './hive-account-api'

export const hiveAccountApi = {
  getLoginCapabilities: () => ipcRenderer.invoke('hiveAccount:getLoginCapabilities'),
  getState: () => ipcRenderer.invoke('hiveAccount:getState'),
  signIn: (options) => ipcRenderer.invoke('hiveAccount:signIn', options),
  startSmsSignIn: (options) => ipcRenderer.invoke('hiveAccount:startSmsSignIn', options),
  cancelSmsSignIn: () => ipcRenderer.invoke('hiveAccount:cancelSmsSignIn'),
  completeSmsSignIn: (options) => ipcRenderer.invoke('hiveAccount:completeSmsSignIn', options),
  refresh: () => ipcRenderer.invoke('hiveAccount:refresh'),
  signOut: () => ipcRenderer.invoke('hiveAccount:signOut'),
  accountSecurity: () => ipcRenderer.invoke('hiveAccount:accountSecurity'),
  setPassword: (newPassword) => ipcRenderer.invoke('hiveAccount:setPassword', newPassword),
  startPasswordReset: (phoneNumber) =>
    ipcRenderer.invoke('hiveAccount:startPasswordReset', phoneNumber),
  verifyPasswordReset: (challengeId, bindingId, smsCode, newPassword) =>
    ipcRenderer.invoke('hiveAccount:verifyPasswordReset', {
      challengeId,
      bindingId,
      smsCode,
      newPassword
    }),
  startPhoneBinding: (phoneNumber) =>
    ipcRenderer.invoke('hiveAccount:startPhoneBinding', phoneNumber),
  verifyPhoneBinding: (challengeId, bindingId, smsCode) =>
    ipcRenderer.invoke('hiveAccount:verifyPhoneBinding', {
      challengeId,
      bindingId,
      smsCode
    }),
  onStateChanged: (callback: (state: HiveAccountState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: HiveAccountState): void => {
      callback(state)
    }
    ipcRenderer.on(HIVE_ACCOUNT_STATE_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(HIVE_ACCOUNT_STATE_CHANGED_CHANNEL, listener)
  }
} satisfies HiveAccountApi
