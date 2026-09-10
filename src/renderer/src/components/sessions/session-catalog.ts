import type { AppState } from '@/store/types'
import { selectExecutionHostDisplayLabel } from '@/lib/execution-host-display-label'
import { buildHomeEntities } from '../landing/desktop-home-model-entities'
import { sessionProjects } from './session-list-model'

/** Share only the immutable catalog projection; it contains no session lifecycle state. */
export function createSessionCatalogSelector() {
  let previous: readonly unknown[] | undefined
  let result:
    | {
        entities: ReturnType<typeof buildHomeEntities>
        projects: ReturnType<typeof sessionProjects>
      }
    | undefined
  return (state: AppState) => {
    const dependencies = [
      state.repos,
      state.worktreesByRepo,
      state.folderWorkspaces,
      state.projectGroups,
      state.projects,
      state.projectHostSetups,
      state.settings,
      state.runtimeEnvironments,
      state.sshTargetLabels,
      state.removedSshTargetLabels,
      state.sshStateByEnvironment
    ]
    if (result && dependencies.every((value, index) => value === previous?.[index])) {
      return result
    }
    const entities = buildHomeEntities(
      {
        repos: state.repos,
        worktreesByRepo: state.worktreesByRepo,
        folderWorkspaces: state.folderWorkspaces,
        projectGroups: state.projectGroups,
        projects: state.projects,
        projectHostSetups: state.projectHostSetups,
        tabsByWorktree: {},
        unifiedTabsByWorktree: {},
        openFiles: []
      },
      state.repos
    )
    previous = dependencies
    result = {
      entities,
      projects: sessionProjects(entities, (host) => selectExecutionHostDisplayLabel(state, host))
    }
    return result
  }
}

export const selectSessionCatalog = createSessionCatalogSelector()
