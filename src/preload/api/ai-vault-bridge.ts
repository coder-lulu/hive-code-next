import { createSessionSearchClient } from '../../shared/ai-vault-search-client'
import type { AiVaultSearchRequest, AiVaultSearchStatus } from '../../shared/ai-vault-search-types'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../../shared/execution-host'
import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

function searchClient(
  executionHostScope?: ExecutionHostScope
): ReturnType<typeof createSessionSearchClient> {
  // `all` is merged by this desktop, which already redacted each remote leg.
  const remote =
    executionHostScope !== undefined &&
    executionHostScope !== LOCAL_EXECUTION_HOST_ID &&
    executionHostScope !== ALL_EXECUTION_HOSTS_SCOPE
  return createSessionSearchClient(
    (method, params) =>
      method === 'aiVault.searchSessions'
        ? ipcRenderer.invoke('aiVault:searchSessions', params, executionHostScope)
        : ipcRenderer.invoke('aiVault:searchStatus', executionHostScope),
    remote ? 'relay' : 'ipc'
  )
}

export const aiVaultApi: PreloadApi['aiVault'] = {
  searchSessions: (request: AiVaultSearchRequest, executionHostScope?: ExecutionHostScope) =>
    searchClient(executionHostScope).searchSessions(request),
  searchStatus: (executionHostScope?: ExecutionHostId) =>
    searchClient(executionHostScope).searchStatus(),
  setSearchEnabled: (
    executionHostId: ExecutionHostId,
    enabled: boolean
  ): Promise<AiVaultSearchStatus> =>
    ipcRenderer.invoke('aiVault:setSearchEnabled', executionHostId, enabled),
  clearSearchIndex: (): Promise<void> => ipcRenderer.invoke('aiVault:clearSearchIndex'),
  listSessions: (args) => ipcRenderer.invoke('aiVault:listSessions', args),
  resolveSessionTitles: (args) => ipcRenderer.invoke('aiVault:resolveSessionTitles', args),
  cancelListSessions: (args: { requestToken: string }): Promise<void> =>
    ipcRenderer.invoke('aiVault:cancelListSessions', args),
  prepareSessionResume: (args) => ipcRenderer.invoke('aiVault:prepareSessionResume', args),
  listSubagentSessions: (args) => ipcRenderer.invoke('aiVault:listSubagentSessions', args),
  getFirstUserPrompt: (args) => ipcRenderer.invoke('aiVault:getFirstUserPrompt', args),
  deleteSession: (args) => ipcRenderer.invoke('aiVault:deleteSession', args),
  onWindowFocused: (callback: () => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback()
    ipcRenderer.on('aiVault:windowFocused', listener)
    return () => ipcRenderer.removeListener('aiVault:windowFocused', listener)
  }
}
