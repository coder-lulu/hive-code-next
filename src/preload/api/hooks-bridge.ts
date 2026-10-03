import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const hooksApi: PreloadApi['hooks'] = {
  check: (args) => ipcRenderer.invoke('hooks:check', args),
  inspectSetupScriptImports: (args) => ipcRenderer.invoke('hooks:inspectSetupScriptImports', args),
  createIssueCommandRunner: (args) => ipcRenderer.invoke('hooks:createIssueCommandRunner', args),
  readIssueCommand: (args) => ipcRenderer.invoke('hooks:readIssueCommand', args),
  writeIssueCommand: (args) => ipcRenderer.invoke('hooks:writeIssueCommand', args)
}
