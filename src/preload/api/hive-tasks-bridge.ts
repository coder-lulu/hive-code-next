import { ipcRenderer } from 'electron'
import type { HiveTasksApi } from '../../shared/hive-tasks'

export const hiveTasksApi: HiveTasksApi = {
  listCompanies: (query) => ipcRenderer.invoke('hiveTasks:listCompanies', query),
  createCompany: (input) => ipcRenderer.invoke('hiveTasks:createCompany', input),
  listProjects: (query) => ipcRenderer.invoke('hiveTasks:listProjects', query),
  createProject: (input) => ipcRenderer.invoke('hiveTasks:createProject', input),
  getTeam: (projectId) => ipcRenderer.invoke('hiveTasks:getTeam', projectId),
  configureTeam: (input) => ipcRenderer.invoke('hiveTasks:configureTeam', input),
  listWorkflows: (query) => ipcRenderer.invoke('hiveTasks:listWorkflows', query),
  getWorkflow: (query) => ipcRenderer.invoke('hiveTasks:getWorkflow', query),
  saveWorkflow: (input) => ipcRenderer.invoke('hiveTasks:saveWorkflow', input),
  createWorkflowCase: (input) => ipcRenderer.invoke('hiveTasks:createWorkflowCase', input),
  listWorkflowCases: (query) => ipcRenderer.invoke('hiveTasks:listWorkflowCases', query),
  getWorkflowCase: (query) => ipcRenderer.invoke('hiveTasks:getWorkflowCase', query),
  getWorkflowPlanApplication: (query) =>
    ipcRenderer.invoke('hiveTasks:getWorkflowPlanApplication', query),
  applyWorkflowPlan: (input) => ipcRenderer.invoke('hiveTasks:applyWorkflowPlan', input),
  startWorkflowCase: (input) => ipcRenderer.invoke('hiveTasks:startWorkflowCase', input),
  getWorkflowCaseRuns: (query) => ipcRenderer.invoke('hiveTasks:getWorkflowCaseRuns', query),
  getWorkflowCaseSessionPage: (query) =>
    ipcRenderer.invoke('hiveTasks:getWorkflowCaseSessionPage', query),
  getWorkflowCaseCodePage: (query) =>
    ipcRenderer.invoke('hiveTasks:getWorkflowCaseCodePage', query),
  getWorkflowCaseCodeFile: (query) =>
    ipcRenderer.invoke('hiveTasks:getWorkflowCaseCodeFile', query),
  list: () => ipcRenderer.invoke('hiveTasks:list'),
  create: (input) => ipcRenderer.invoke('hiveTasks:create', input),
  cancel: (id, runId) => ipcRenderer.invoke('hiveTasks:cancel', id, runId),
  artifact: (id, runId, ref) => ipcRenderer.invoke('hiveTasks:artifact', id, runId, ref)
}
