import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const linearApi: PreloadApi['linear'] = {
  connect: (args) => ipcRenderer.invoke('linear:connect', args),
  disconnect: (args) => ipcRenderer.invoke('linear:disconnect', args),
  selectWorkspace: (args) => ipcRenderer.invoke('linear:selectWorkspace', args),
  status: () => ipcRenderer.invoke('linear:status'),
  testConnection: (args) => ipcRenderer.invoke('linear:testConnection', args),
  searchIssues: (args) => ipcRenderer.invoke('linear:searchIssues', args),
  listIssues: (args) => ipcRenderer.invoke('linear:listIssues', args),
  createIssue: (args) => ipcRenderer.invoke('linear:createIssue', args),
  getIssue: (args) => ipcRenderer.invoke('linear:getIssue', args),
  updateIssue: (args) => ipcRenderer.invoke('linear:updateIssue', args),
  addIssueComment: (args) => ipcRenderer.invoke('linear:addIssueComment', args),
  issueComments: (args) => ipcRenderer.invoke('linear:issueComments', args),
  listTeams: (args) => ipcRenderer.invoke('linear:listTeams', args),
  listProjects: (args) => ipcRenderer.invoke('linear:listProjects', args),
  createProject: (args) => ipcRenderer.invoke('linear:createProject', args),
  getProject: (args) => ipcRenderer.invoke('linear:getProject', args),
  listProjectIssues: (args) => ipcRenderer.invoke('linear:listProjectIssues', args),
  listCustomViews: (args) => ipcRenderer.invoke('linear:listCustomViews', args),
  getCustomView: (args) => ipcRenderer.invoke('linear:getCustomView', args),
  listCustomViewIssues: (args) => ipcRenderer.invoke('linear:listCustomViewIssues', args),
  listCustomViewProjects: (args) => ipcRenderer.invoke('linear:listCustomViewProjects', args),
  teamStates: (args) => ipcRenderer.invoke('linear:teamStates', args),
  teamLabels: (args) => ipcRenderer.invoke('linear:teamLabels', args),
  teamMembers: (args) => ipcRenderer.invoke('linear:teamMembers', args)
}
