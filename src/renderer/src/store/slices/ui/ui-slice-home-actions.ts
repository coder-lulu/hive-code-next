import { isFloatingTerminalWorkspaceId } from '@/lib/floating-terminal'
import { getExecutionHostIdForFolderWorkspace } from '@/lib/folder-workspace-runtime-owner'
import { getRepoExecutionHostId } from '../repo-host-identity'
import { normalizeExecutionHostId } from '../../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'

function returnScope(get: UISliceGet) {
  const state = get()
  const parsed = state.activeWorkspaceKey ? parseWorkspaceKey(state.activeWorkspaceKey) : null
  if (
    (parsed?.type === 'worktree' && isFloatingTerminalWorkspaceId(parsed.worktreeId)) ||
    isFloatingTerminalWorkspaceId(state.activeWorktreeId)
  ) {
    return null
  }
  const scope =
    parsed ??
    (state.activeWorktreeId
      ? { type: 'worktree' as const, worktreeId: state.activeWorktreeId }
      : null)
  if (!scope) {
    return null
  }
  if (scope.type === 'folder') {
    return {
      scope,
      executionHostId:
        state.activeWorkspaceExecutionHostId ??
        getExecutionHostIdForFolderWorkspace(state, scope.folderWorkspaceId),
      repoId: null
    }
  }
  const worktree = state.getKnownWorktreeById(scope.worktreeId)
  const repoId = state.activeRepoId ?? worktree?.repoId ?? null
  const repo = repoId ? state.repos.find((item) => item.id === repoId) : undefined
  return {
    scope,
    executionHostId:
      state.activeWorkspaceExecutionHostId ??
      normalizeExecutionHostId(worktree?.hostId) ??
      (repo ? getRepoExecutionHostId(repo) : null),
    repoId
  }
}

export function createUiHomeActions(
  set: UISliceSet,
  get: UISliceGet
): Pick<
  UISlice,
  | 'homeTaskDraft'
  | 'setHomeTaskDraft'
  | 'homePendingSessionAssignment'
  | 'setHomePendingSessionAssignment'
  | 'homeReturnScope'
  | 'homeNewTaskMode'
  | 'homeComposerFocusRequest'
  | 'openStartupHome'
  | 'openNewTaskHome'
  | 'restoreHomeReturnScope'
  | 'exitNewTaskHome'
> {
  return {
    homeTaskDraft: '',
    homePendingSessionAssignment: null,
    homeReturnScope: null,
    homeNewTaskMode: false,
    homeComposerFocusRequest: 0,
    setHomeTaskDraft: (homeTaskDraft) => set({ homeTaskDraft }),
    setHomePendingSessionAssignment: (homePendingSessionAssignment) =>
      set({ homePendingSessionAssignment }),
    openStartupHome: () => {
      const state = get()
      if (state.activeWorktreeId || state.activeWorkspaceKey) {
        state.setActiveWorktree(null)
      }
      set({
        activeView: 'terminal',
        activeRepoId: null,
        homeNewTaskMode: false,
        homePendingSessionAssignment: null,
        homeReturnScope: null
      })
    },
    openNewTaskHome: () => {
      const state = get()
      const current = returnScope(get) ?? (state.homeNewTaskMode ? state.homeReturnScope : null)
      if (state.activeWorktreeId || state.activeWorkspaceKey) {
        state.setActiveWorktree(null)
      }
      set((previous) => ({
        activeView: 'terminal',
        activeRepoId: null,
        homeNewTaskMode: true,
        homePendingSessionAssignment: null,
        homeReturnScope: current,
        homeComposerFocusRequest: previous.homeComposerFocusRequest + 1
      }))
    },
    restoreHomeReturnScope: () => {
      const current = get().homeReturnScope
      if (!current) {
        return false
      }
      let activated = false
      if (current.scope.type === 'folder') {
        const folder = get().folderWorkspaces.find(
          (entry) => entry.id === current.scope.folderWorkspaceId
        )
        if (folder) {
          get().setActiveFolderWorkspace(
            folder.id,
            current.executionHostId ?? getExecutionHostIdForFolderWorkspace(get(), folder.id)
          )
          activated = get().activeWorkspaceKey === `folder:${folder.id}`
        }
      } else {
        const worktree = get().getKnownWorktreeById(
          current.scope.worktreeId,
          current.executionHostId ?? undefined
        )
        if (worktree) {
          if (current.repoId && get().activeRepoId !== current.repoId) {
            get().setActiveRepo(current.repoId)
          }
          activated = Boolean(
            get().setActiveWorktree(worktree.id, current.executionHostId ?? undefined)
          )
        }
      }
      if (activated) {
        set({ homeNewTaskMode: false, homeReturnScope: null, homePendingSessionAssignment: null })
      }
      return activated
    },
    exitNewTaskHome: () =>
      set({ homeNewTaskMode: false, homeReturnScope: null, homePendingSessionAssignment: null })
  }
}
