import { ipcRenderer } from 'electron'
import {
  HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL,
  HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL,
  type HiveAccountRuntimeDirectoryState,
  type HiveLocalRuntimeOwnershipState
} from '../../shared/hive-runtime-cloud'
import type { HiveRuntimeCloudApi } from './hive-runtime-cloud-api'

export const hiveRuntimeCloudApi = {
  getDirectory: () => ipcRenderer.invoke('hiveRuntimeCloud:getDirectory'),
  refreshDirectory: () => ipcRenderer.invoke('hiveRuntimeCloud:refreshDirectory'),
  updateDisplayName: (request) => ipcRenderer.invoke('hiveRuntimeCloud:updateDisplayName', request),
  discardDisplayName: (request) =>
    ipcRenderer.invoke('hiveRuntimeCloud:discardDisplayName', request),
  getLocalOwnership: () => ipcRenderer.invoke('hiveRuntimeCloud:getLocalOwnership'),
  refreshLocalOwnership: () => ipcRenderer.invoke('hiveRuntimeCloud:refreshLocalOwnership'),
  claimLocalRuntime: (request) => ipcRenderer.invoke('hiveRuntimeCloud:claimLocalRuntime', request),
  listSessions: (cursor = null) => ipcRenderer.invoke('hiveRuntimeCloud:listSessions', cursor),
  revokeSession: (request) => ipcRenderer.invoke('hiveRuntimeCloud:revokeSession', request),
  onDirectoryChanged: (callback: (state: HiveAccountRuntimeDirectoryState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: HiveAccountRuntimeDirectoryState
    ): void => callback(state)
    ipcRenderer.on(HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(HIVE_RUNTIME_DIRECTORY_CHANGED_CHANNEL, listener)
  },
  onOwnershipChanged: (callback: (state: HiveLocalRuntimeOwnershipState) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: HiveLocalRuntimeOwnershipState
    ): void => callback(state)
    ipcRenderer.on(HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(HIVE_RUNTIME_OWNERSHIP_CHANGED_CHANNEL, listener)
  }
} satisfies HiveRuntimeCloudApi
