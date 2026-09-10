import { routeNativeChatHref } from '../../../../shared/native-chat-href-routing'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  parseExplicitFileLinkTarget,
  resolveExplicitFileLinkTarget
} from '@/lib/explicit-file-link-target'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { AppState } from '@/store/types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { getExecutionHostIdFromWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'

export type NativeChatFileLinkContext = {
  worktreeId: string
  worktreePath: string
  runtimeEnvironmentId: string | null
}

export type NativeChatResolvedFileLink = {
  absolutePath: string
  line: number | null
  column: number | null
}

type NativeChatFileLinkState = Pick<
  AppState,
  | 'folderWorkspaces'
  | 'getKnownWorktreeById'
  | 'projectGroups'
  | 'repos'
  | 'settings'
  | 'tabsByWorktree'
  | 'worktreesByRepo'
> & {
  unifiedTabsByWorktree?: AppState['unifiedTabsByWorktree']
}

export function findTerminalTabWorktreeId(
  tabsByWorktree: NativeChatFileLinkState['tabsByWorktree'],
  terminalTabId: string
): string | null {
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    // Why: tabsByWorktree stores TerminalTab records; unified tabs carry
    // entityId, but the terminal owner lookup must use the backing tab id.
    if (tabs.some((tab) => tab.id === terminalTabId)) {
      return worktreeId
    }
  }
  return null
}

function findWorktreeFallback(
  worktreesByRepo: NativeChatFileLinkState['worktreesByRepo'],
  worktreeId: string
): Pick<Worktree, 'id' | 'path'> | null {
  for (const worktrees of Object.values(worktreesByRepo)) {
    const worktree = worktrees.find((entry) => entry.id === worktreeId)
    if (worktree) {
      return worktree
    }
  }
  return null
}

export function resolveNativeChatFileLinkContext(
  state: NativeChatFileLinkState,
  terminalTabId: string
): NativeChatFileLinkContext | null {
  const terminalOwners = Object.entries(state.tabsByWorktree).flatMap(([bucket, tabs]) =>
    tabs.filter((tab) => tab.id === terminalTabId).map(() => bucket)
  )
  const structuredOwners = Object.entries(state.unifiedTabsByWorktree ?? {}).flatMap(
    ([bucket, tabs]) =>
      tabs
        .filter((tab) => tab.id === terminalTabId && tab.contentType === 'agent-session')
        .map((tab) => ({ bucket, tab }))
  )
  // File/image consumers have only a tab id: an ambiguous owner must never win by insertion order.
  if (terminalOwners.length + structuredOwners.length !== 1) {
    return null
  }
  const structured = structuredOwners[0]
  const worktreeId = terminalOwners[0] ?? structured.bucket
  const bucketHost = getExecutionHostIdFromWorktreeHostIdentity(worktreeId)
  const tabHost =
    structured?.tab.executionHostId ??
    getExecutionHostIdFromWorktreeHostIdentity(structured?.tab.worktreeId ?? '')
  const expectedHost = bucketHost ?? tabHost
  let runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
  if (structured) {
    const resolution = resolveWorktreeOperationRouteResult(
      {
        ...state,
        activeWorktreeId: null,
        activeWorkspaceExecutionHostId: null
      },
      worktreeId
    )
    if (
      (bucketHost && tabHost && bucketHost !== tabHost) ||
      resolution.kind === 'ambiguous' ||
      (expectedHost &&
        (resolution.kind !== 'resolved' || resolution.route.executionHostId !== expectedHost))
    ) {
      return null
    }
    if (expectedHost && resolution.kind === 'resolved') {
      runtimeEnvironmentId = resolution.route.runtimeEnvironmentId
    }
  }

  const knownWorktree = state.getKnownWorktreeById(worktreeId, expectedHost)
  const worktree = knownWorktree?.path
    ? knownWorktree
    : findWorktreeFallback(state.worktreesByRepo, worktreeId)
  const workspaceScope = parseWorkspaceKey(worktreeId)
  const worktreePath =
    worktree?.path ??
    (workspaceScope?.type === 'folder'
      ? (state.folderWorkspaces.find(
          (workspace) => workspace.id === workspaceScope.folderWorkspaceId
        )?.folderPath ?? null)
      : null)
  if (!worktreePath) {
    return null
  }

  return {
    worktreeId,
    worktreePath,
    runtimeEnvironmentId
  }
}

function resolvePathText(
  pathText: string,
  fallbackLine: number | null,
  context: NativeChatFileLinkContext
): NativeChatResolvedFileLink | null {
  const parsed = parseExplicitFileLinkTarget(pathText, { allowRelativeDirectoryPath: true })
  if (!parsed) {
    return null
  }
  // Native chat hrefs are explicit agent-authored links, so avoid the terminal
  // detector's conservative extension/filename filters.
  const resolved = resolveExplicitFileLinkTarget(parsed, context.worktreePath)
  if (!resolved) {
    return null
  }
  return {
    absolutePath: resolved.absolutePath,
    line: resolved.line ?? fallbackLine,
    column: resolved.column
  }
}

export function resolveNativeChatFileLink(
  href: string | undefined,
  context: NativeChatFileLinkContext | null
): NativeChatResolvedFileLink | null {
  if (!context) {
    return null
  }
  const route = routeNativeChatHref(href)
  if (route.kind !== 'file') {
    return null
  }
  return resolvePathText(route.pathText, route.line, context)
}
