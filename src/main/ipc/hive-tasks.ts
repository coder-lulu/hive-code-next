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
import type {
  HiveWorkflowListQuery,
  HiveWorkflowReadQuery,
  HiveWorkflowSave
} from '../../shared/hive-task-workflows'
import type {
  HiveWorkflowCaseCreate,
  HiveWorkflowCaseListQuery,
  HiveWorkflowCaseReadQuery
} from '../../shared/hive-workflow-cases'

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
  bind('cancel', (facade, id: string, runId: string) => facade.cancel(id, runId))
  bind('artifact', (facade, id: string, runId: string, ref: string) =>
    facade.artifact(id, runId, ref)
  )
  bind('listCompanies', (facade, query?: HiveWorkbenchPageQuery) => facade.listCompanies(query))
  bind('createCompany', (facade, input: HiveWorkbenchCompanyCreate) => facade.createCompany(input))
  bind('listProjects', (facade, query: HiveWorkbenchProjectsQuery) => facade.listProjects(query))
  bind('createProject', (facade, input: HiveWorkbenchProjectCreate) => facade.createProject(input))
  bind('getTeam', (facade, projectId: string) => facade.getTeam(projectId))
  bind('configureTeam', (facade, input: HiveWorkbenchTeamConfigure) => facade.configureTeam(input))
  bind('listWorkflows', (facade, query: HiveWorkflowListQuery) => facade.listWorkflows(query))
  bind('getWorkflow', (facade, query: HiveWorkflowReadQuery) => facade.getWorkflow(query))
  bind('saveWorkflow', (facade, input: HiveWorkflowSave) => facade.saveWorkflow(input))
  bind('createWorkflowCase', (facade, input: HiveWorkflowCaseCreate) =>
    facade.createWorkflowCase(input)
  )
  bind('listWorkflowCases', (facade, query: HiveWorkflowCaseListQuery) =>
    facade.listWorkflowCases(query)
  )
  bind('getWorkflowCase', (facade, query: HiveWorkflowCaseReadQuery) =>
    facade.getWorkflowCase(query)
  )
}
