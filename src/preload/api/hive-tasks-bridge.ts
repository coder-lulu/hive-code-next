import { ipcRenderer } from 'electron'
import type { HiveTasksApi } from '../../shared/hive-tasks'

export const hiveTasksApi: HiveTasksApi = {
  list: () => ipcRenderer.invoke('hiveTasks:list'),
  create: (input) => ipcRenderer.invoke('hiveTasks:create', input),
  cancel: (id) => ipcRenderer.invoke('hiveTasks:cancel', id),
  artifact: (id, ref) => ipcRenderer.invoke('hiveTasks:artifact', id, ref)
}
