import { canonicalAgentSessionDigest } from '../../shared/agent-session-mutation-envelope'
import type { HiveTeamWorkbenchApi, HiveWorkbenchTeam } from '../../shared/hive-team-workbench'
import {
  HiveWorkflowListQuerySchema,
  HiveWorkflowPageSchema,
  HiveWorkflowReadQuerySchema,
  HiveWorkflowSaveSchema,
  HiveWorkflowSnapshotSchema,
  type HiveTaskWorkflowsApi,
  type HiveWorkflowSnapshot
} from '../../shared/hive-task-workflows'
import type { HiveTaskRequestContext, HiveTaskWorkspaceProof } from './hive-team-workbench-facade'
import { refuseTaskExecution } from './task-execution-error'

export function createHiveTaskWorkflowFacade(options: {
  context(): Promise<HiveTaskRequestContext>
  getTeam: HiveTeamWorkbenchApi['getTeam']
  validateWorkspace(selector: string): Promise<HiveTaskWorkspaceProof>
}): HiveTaskWorkflowsApi {
  const projectTeam = async (caller: HiveTaskRequestContext, projectId: string) => {
    caller.assertCurrent()
    const team = await options.getTeam(projectId)
    caller.assertCurrent()
    if (team.project.id !== projectId) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
    return team
  }
  const assertScope = (snapshot: HiveWorkflowSnapshot, team: HiveWorkbenchTeam) => {
    if (
      snapshot.definition.scope.companyRef !== team.company.id ||
      snapshot.definition.scope.projectRef !== team.project.id
    ) {
      return refuseTaskExecution('REVISION_CONFLICT')
    }
  }
  const request = async (caller: HiveTaskRequestContext, path: string, body: unknown) => {
    caller.assertCurrent()
    const result = await caller.request(path, body)
    caller.assertCurrent()
    return result
  }
  return {
    async listWorkflows(rawQuery) {
      const query = HiveWorkflowListQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const team = await projectTeam(caller, query.projectId)
      const page = HiveWorkflowPageSchema.parse(
        await request(caller, '/hive/workbench/workflows/list', query)
      )
      page.items.forEach((snapshot) => assertScope(snapshot, team))
      if (page.items.length > query.limit) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return page
    },
    async getWorkflow(rawQuery) {
      const query = HiveWorkflowReadQuerySchema.parse(rawQuery)
      const caller = await options.context()
      const team = await projectTeam(caller, query.projectId)
      const snapshot = HiveWorkflowSnapshotSchema.parse(
        await request(caller, '/hive/workbench/workflows/read', query)
      )
      assertScope(snapshot, team)
      if (
        snapshot.workflowId !== query.workflowId ||
        (query.revision !== undefined && snapshot.definition.workflowRevision !== query.revision)
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return snapshot
    },
    async saveWorkflow(rawInput) {
      const input = HiveWorkflowSaveSchema.parse(rawInput)
      const caller = await options.context()
      const team = await projectTeam(caller, input.projectId)
      // The service checks receipts before CAS so a later team binding cannot hide a committed save.
      const workspace = await options.validateWorkspace(team.project.workspaceSelector)
      workspace.assertCurrent()
      caller.assertCurrent()
      if (workspace.workspaceRef !== team.project.binding.hiveWorkspaceRef) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      const result = await request(caller, '/hive/workbench/workflows/save', input)
      workspace.assertCurrent()
      caller.assertCurrent()
      const snapshot = HiveWorkflowSnapshotSchema.parse(result)
      assertScope(snapshot, team)
      const fields = ({
        name,
        stages,
        maxParallelism,
        maxDurationMs
      }: Pick<typeof input, 'name' | 'stages' | 'maxParallelism' | 'maxDurationMs'>) =>
        canonicalAgentSessionDigest({ name, stages, maxParallelism, maxDurationMs })
      if (
        (input.workflowId !== undefined && snapshot.workflowId !== input.workflowId) ||
        snapshot.projectBindingRevision !== input.expectedProjectRevision ||
        snapshot.definition.workflowRevision !== input.expectedRevision + 1 ||
        fields({ name: snapshot.name, ...snapshot.definition }) !==
          fields({
            name: input.name,
            stages: input.stages,
            maxParallelism: input.maxParallelism,
            maxDurationMs: input.maxDurationMs
          })
      ) {
        return refuseTaskExecution('REVISION_CONFLICT')
      }
      return snapshot
    }
  }
}
