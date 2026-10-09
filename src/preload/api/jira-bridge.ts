import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const jiraApi: PreloadApi['jira'] = {
  connect: (args) => ipcRenderer.invoke('jira:connect', args),
  disconnect: (args) => ipcRenderer.invoke('jira:disconnect', args),
  selectSite: (args) => ipcRenderer.invoke('jira:selectSite', args),
  status: () => ipcRenderer.invoke('jira:status'),
  readStatus: () => ipcRenderer.invoke('jira:readStatus'),
  testConnection: (args) => ipcRenderer.invoke('jira:testConnection', args),
  searchIssues: (args) => ipcRenderer.invoke('jira:searchIssues', args),
  cancelSearchIssues: (args) => ipcRenderer.invoke('jira:cancelSearchIssues', args),
  listIssues: (args) => ipcRenderer.invoke('jira:listIssues', args),
  getIssue: (args) => ipcRenderer.invoke('jira:getIssue', args),
  lookupIssueSummary: (args) => ipcRenderer.invoke('jira:lookupIssueSummary', args),
  cancelIssueSummary: (args) => ipcRenderer.invoke('jira:cancelIssueSummary', args),
  createIssue: (args) => ipcRenderer.invoke('jira:createIssue', args),
  updateIssue: (args) => ipcRenderer.invoke('jira:updateIssue', args),
  addIssueComment: (args) => ipcRenderer.invoke('jira:addIssueComment', args),
  issueComments: (args) => ipcRenderer.invoke('jira:issueComments', args),
  listProjects: (args) => ipcRenderer.invoke('jira:listProjects', args),
  listIssueTypes: (args) => ipcRenderer.invoke('jira:listIssueTypes', args),
  listCreateFields: (args) => ipcRenderer.invoke('jira:listCreateFields', args),
  listPriorities: (args) => ipcRenderer.invoke('jira:listPriorities', args),
  listAssignableUsers: (args) => ipcRenderer.invoke('jira:listAssignableUsers', args),
  listAssignableUsersForProject: (args) =>
    ipcRenderer.invoke('jira:listAssignableUsersForProject', args),
  searchUsers: (args) => ipcRenderer.invoke('jira:searchUsers', args),
  listTransitions: (args) => ipcRenderer.invoke('jira:listTransitions', args),
  getProjectStatusOrder: (args) => ipcRenderer.invoke('jira:getProjectStatusOrder', args)
}
