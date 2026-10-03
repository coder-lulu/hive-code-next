import { ipcMain } from 'electron'
import { getLocalTasks } from '../startup/main-process-tasks'
import { isTrustedUIRenderer } from './ui'
import type { HiveTaskCreate, HiveTasksApi } from '../../shared/hive-tasks'
import type {
  HiveWorkbenchCompanyCreate,
  HiveWorkbenchPageQuery,
  HiveWorkbenchProjectCreate,
  HiveWorkbenchProjectsQuery,
  HiveWorkbenchTeamConfigure
} from '../../shared/hive-team-workbench'

export function registerHiveTaskHandlers() {
  const bind = <Args extends unknown[]>(
    method: keyof HiveTasksApi,
    invoke: (facade: HiveTasksApi, ...args: Args) => Promise<unknown>
  ) => {
    ipcMain.handle(`hiveTasks:${method}`, async (event, ...args: Args) => {
      const assertSender = () => {
        if (
          event.sender.isDestroyed() ||
          !isTrustedUIRenderer(event.sender) ||
          event.senderFrame !== event.sender.mainFrame
        ) {
          throw new Error('FORBIDDEN')
        }
      }
      assertSender()
      const { facade } = await getLocalTasks()
      assertSender()
      const value = await invoke(facade, ...args)
      assertSender()
      return value
    })
  }
  bind('list', (facade) => facade.list())
  bind('create', (facade, input: HiveTaskCreate) => facade.create(input))
  bind('cancel', (facade, id: string) => facade.cancel(id))
  bind('artifact', (facade, id: string, ref: string) => facade.artifact(id, ref))
  bind('listCompanies', (facade, query?: HiveWorkbenchPageQuery) => facade.listCompanies(query))
  bind('createCompany', (facade, input: HiveWorkbenchCompanyCreate) => facade.createCompany(input))
  bind('listProjects', (facade, query: HiveWorkbenchProjectsQuery) => facade.listProjects(query))
  bind('createProject', (facade, input: HiveWorkbenchProjectCreate) => facade.createProject(input))
  bind('getTeam', (facade, projectId: string) => facade.getTeam(projectId))
  bind('configureTeam', (facade, input: HiveWorkbenchTeamConfigure) => facade.configureTeam(input))
}
