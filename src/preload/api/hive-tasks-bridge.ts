import { ipcRenderer } from 'electron'
import type { HiveTasksApi } from '../../shared/hive-tasks'

export const hiveTasksApi: HiveTasksApi = {
  listCompanies: (query) => ipcRenderer.invoke('hiveTasks:listCompanies', query),
  createCompany: (input) => ipcRenderer.invoke('hiveTasks:createCompany', input),
  listProjects: (query) => ipcRenderer.invoke('hiveTasks:listProjects', query),
  createProject: (input) => ipcRenderer.invoke('hiveTasks:createProject', input),
  getTeam: (projectId) => ipcRenderer.invoke('hiveTasks:getTeam', projectId),
  configureTeam: (input) => ipcRenderer.invoke('hiveTasks:configureTeam', input),
  list: () => ipcRenderer.invoke('hiveTasks:list'),
  create: (input) => ipcRenderer.invoke('hiveTasks:create', input),
  cancel: (id) => ipcRenderer.invoke('hiveTasks:cancel', id),
  artifact: (id, ref) => ipcRenderer.invoke('hiveTasks:artifact', id, ref)
}
