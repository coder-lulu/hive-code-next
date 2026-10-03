import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const diagnosticsApi: PreloadApi['diagnostics'] = {
  getStatus: () => ipcRenderer.invoke('diagnostics:getStatus'),
  collectBundle: (lookbackMinutes) =>
    ipcRenderer.invoke('diagnostics:collectBundle', lookbackMinutes),
  openBundlePreview: (bundleSubmissionId) =>
    ipcRenderer.invoke('diagnostics:openBundlePreview', bundleSubmissionId),
  discardBundlePreview: (bundleSubmissionId) =>
    ipcRenderer.invoke('diagnostics:discardBundlePreview', bundleSubmissionId),
  uploadBundle: (bundleSubmissionId) =>
    ipcRenderer.invoke('diagnostics:uploadBundle', bundleSubmissionId),
  deleteBundle: (ticketId) => ipcRenderer.invoke('diagnostics:deleteBundle', ticketId)
}
