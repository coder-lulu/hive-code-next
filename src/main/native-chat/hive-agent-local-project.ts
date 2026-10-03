import { homedir } from 'node:os'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../shared/constants'
import { realpathSync, statSync } from 'node:fs'
import type { Store } from '../persistence'
import type { RuntimeFileCommandHost } from '../runtime/runtime-file-command-host'
import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../shared/execution-host'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { resolveLocalProjectRuntimeForRepo } from '../local-project-runtime-resolution'
import { resolveWorktreeHostRouting } from '../runtime/worktree-launch-host-repo'
import {
  inferFolderWorkspacePathConnection,
  resolveFolderWorkspaceStatusPath
} from '../project-groups/folder-workspace-path-status'
import type { HiveAgentLocalProject } from './hive-agent-local-principal'

type ProjectStore = Pick<
  Store,
  | 'getRepos'
  | 'getProjectGroups'
  | 'getFolderWorkspaces'
  | 'getProjects'
  | 'getSettings'
  | 'getWorktreeMetaForHost'
>
const forbidden = () => new Error('hive_agent_forbidden')

/** Narrows the existing host resolver; a remote or unresolved target never falls back locally. */
export async function resolveHiveAgentLocalProject(
  runtime: Pick<RuntimeFileCommandHost, 'resolveRuntimeFileTarget'>,
  store: ProjectStore,
  selector: string
): Promise<HiveAgentLocalProject> {
  if (selector === FLOATING_TERMINAL_WORKTREE_ID) {
    // Match the normal temporary task's host-owned home folder; no file-tool grants are added.
    const path = realpathSync(homedir())
    const original = statSync(path, { bigint: true })
    if (!original.isDirectory()) {
      throw forbidden()
    }
    return Object.freeze({
      projectScope: FLOATING_TERMINAL_WORKTREE_ID,
      workspaceKind: 'folder' as const,
      assertCurrent() {
        const current = statSync(path, { bigint: true })
        if (
          realpathSync(homedir()) !== path ||
          !current.isDirectory() ||
          current.dev !== original.dev ||
          current.ino !== original.ino ||
          current.birthtimeNs !== original.birthtimeNs
        ) {
          throw forbidden()
        }
      }
    })
  }
  const target = await runtime.resolveRuntimeFileTarget(selector)
  if (target.executionHostId !== LOCAL_EXECUTION_HOST_ID || parseWslUncPath(target.worktree.path)) {
    throw forbidden()
  }
  const { id, path } = target.worktree
  const scope = parseWorkspaceKey(id)
  const folderId = scope?.type === 'folder' ? scope.folderWorkspaceId : null
  const metadata = store.getWorktreeMetaForHost(id, LOCAL_EXECUTION_HOST_ID)
  const originalInstance = metadata?.instanceId
  const signature = () => {
    if (folderId) {
      const folder = store.getFolderWorkspaces().find((entry) => entry.id === folderId)
      if (
        !folder ||
        folder.isArchived ||
        folder.connectionId ||
        (folder.executionHostId && folder.executionHostId !== LOCAL_EXECUTION_HOST_ID)
      ) {
        throw forbidden()
      }
      const connection = inferFolderWorkspacePathConnection({
        ...resolveFolderWorkspaceStatusPath({
          store,
          request: { scope: 'folder-workspace', folderWorkspaceId: folderId }
        }),
        projectGroups: store.getProjectGroups(),
        repos: store.getRepos()
      })
      if (connection.kind !== 'local' || realpathSync(folder.folderPath) !== realpathSync(path)) {
        throw forbidden()
      }
      return JSON.stringify([folder.id, folder.folderPath, folder.projectGroupId, folder.createdAt])
    }
    const routing = resolveWorktreeHostRouting(store.getRepos(), target.worktree)
    if (
      routing.kind !== 'resolved' ||
      routing.hostId !== LOCAL_EXECUTION_HOST_ID ||
      !routing.repo
    ) {
      throw forbidden()
    }
    const repo = routing.repo
    if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
      throw forbidden()
    }
    const runtime = resolveLocalProjectRuntimeForRepo(store, repo)
    if (!runtime || runtime.status !== 'resolved' || runtime.runtime.kind === 'wsl') {
      throw forbidden()
    }
    const meta = store.getWorktreeMetaForHost(id, LOCAL_EXECUTION_HOST_ID)
    if (
      meta?.isArchived ||
      (meta?.hostId && meta.hostId !== LOCAL_EXECUTION_HOST_ID) ||
      (originalInstance && meta?.instanceId !== originalInstance)
    ) {
      throw forbidden()
    }
    return JSON.stringify([repo.id, repo.path, repo.addedAt, runtime.runtime.cacheKey])
  }
  const physical = () => {
    const canonical = realpathSync(path)
    const stat = statSync(canonical, { bigint: true })
    if (!stat.isDirectory()) {
      throw forbidden()
    }
    return JSON.stringify([
      canonical,
      stat.dev.toString(),
      stat.ino.toString(),
      stat.birthtimeNs.toString()
    ])
  }
  const initialSignature = signature()
  const initialPhysical = physical()
  return Object.freeze({
    projectScope: id,
    workspaceKind: folderId ? 'folder' : 'git-worktree',
    assertCurrent() {
      try {
        if (signature() !== initialSignature || physical() !== initialPhysical) {
          throw forbidden()
        }
      } catch {
        throw forbidden()
      }
    }
  })
}
