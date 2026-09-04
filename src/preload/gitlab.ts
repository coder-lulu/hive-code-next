/* GitLab bindings stay separate so provider changes do not churn the central preload composition. */
import { ipcRenderer } from 'electron'
import type { PreloadApi } from './api-types'

export const glApi: PreloadApi['gl'] = {
  viewer: () => ipcRenderer.invoke('gitlab:viewer'),
  diagnoseAuth: () => ipcRenderer.invoke('gitlab:diagnoseAuth'),
  rateLimit: (args) => ipcRenderer.invoke('gitlab:rateLimit', args),
  projectSlug: (args) => ipcRenderer.invoke('gitlab:projectSlug', args),
  mrForBranch: (args) => ipcRenderer.invoke('gitlab:mrForBranch', args),
  mr: (args) => ipcRenderer.invoke('gitlab:mr', args),
  listMRs: (args) => ipcRenderer.invoke('gitlab:listMRs', args),
  listWorkItems: (args) => ipcRenderer.invoke('gitlab:listWorkItems', args),
  issue: (args) => ipcRenderer.invoke('gitlab:issue', args),
  listIssues: (args) => ipcRenderer.invoke('gitlab:listIssues', args),
  createIssue: (args) => ipcRenderer.invoke('gitlab:createIssue', args),
  updateIssue: (args) => ipcRenderer.invoke('gitlab:updateIssue', args),
  addIssueComment: (args) => ipcRenderer.invoke('gitlab:addIssueComment', args),
  listLabels: (args) => ipcRenderer.invoke('gitlab:listLabels', args),
  listAssignableUsers: (args) => ipcRenderer.invoke('gitlab:listAssignableUsers', args),
  todos: (args) => ipcRenderer.invoke('gitlab:todos', args),
  workItemDetails: (args) => ipcRenderer.invoke('gitlab:workItemDetails', args),
  closeMR: (args) => ipcRenderer.invoke('gitlab:closeMR', args),
  reopenMR: (args) => ipcRenderer.invoke('gitlab:reopenMR', args),
  mergeMR: (args) => ipcRenderer.invoke('gitlab:mergeMR', args),
  updateMR: (args) => ipcRenderer.invoke('gitlab:updateMR', args),
  updateMRReviewers: (args) => ipcRenderer.invoke('gitlab:updateMRReviewers', args),
  addMRComment: (args) => ipcRenderer.invoke('gitlab:addMRComment', args),
  addMRInlineComment: (args) => ipcRenderer.invoke('gitlab:addMRInlineComment', args),
  resolveMRDiscussion: (args) => ipcRenderer.invoke('gitlab:resolveMRDiscussion', args),
  jobTrace: (args) => ipcRenderer.invoke('gitlab:jobTrace', args),
  retryJob: (args) => ipcRenderer.invoke('gitlab:retryJob', args),
  workItemByPath: (args) => ipcRenderer.invoke('gitlab:workItemByPath', args)
}
