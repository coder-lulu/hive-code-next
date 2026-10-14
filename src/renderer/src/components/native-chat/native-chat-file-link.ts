import type { Worktree } from '../../../../shared/worktree/types'
import { routeNativeChatHref } from '../../../../shared/native-chat-href-routing'
import {
  parseExplicitFileLinkTarget,
  resolveExplicitFileLinkTarget,
  resolveExplicitFileLinkTargetPath
} from '@/lib/explicit-file-link-target'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import type { AppState } from '@/store/types'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolveWorktreeOperationRouteResult } from '@/lib/worktree-operation-route'
import { getExecutionHostIdFromWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import { resolveNativeChatTabDirectory } from './native-chat-tab-directory'

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

export type NativeChatFileLinkState = Pick<
  AppState,
  | 'detectedWorktreesByRepo'
  | 'folderWorkspaces'
  | 'getKnownWorktreeById'
  | 'floatingWorkspacePath'
  | 'projectGroups'
  | 'repos'
  | 'settings'
  | 'tabsByWorktree'
  | 'worktreesByRepo'
> & {
  unifiedTabsByWorktree?: AppState['unifiedTabsByWorktree']
  structuredSessionLaunchDirectoryByTabId?: AppState['structuredSessionLaunchDirectoryByTabId']
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

/** The workspace that owns a native chat tab, independent of whether its directory is known. */
export function findNativeChatTabOwnerWorktreeId(
  state: Pick<NativeChatFileLinkState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>,
  tabId: string
): string | null {
  const owners = [
    ...Object.entries(state.tabsByWorktree).flatMap(([bucket, tabs]) =>
      tabs.filter((tab) => tab.id === tabId).map(() => bucket)
    ),
    ...Object.entries(state.unifiedTabsByWorktree ?? {}).flatMap(([bucket, tabs]) =>
      tabs
        .filter((tab) => tab.id === tabId && tab.contentType === 'agent-session')
        .map(() => bucket)
    )
  ]
  return owners.length === 1 ? owners[0] : null
}

export function createNativeChatTabOwnerSelector(tabId: string) {
  let terminalTabs: NativeChatFileLinkState['tabsByWorktree'] | null = null
  let unifiedTabs: NativeChatFileLinkState['unifiedTabsByWorktree']
  let owner: string | null = null
  return (state: Pick<NativeChatFileLinkState, 'tabsByWorktree' | 'unifiedTabsByWorktree'>) => {
    // Hidden chats still subscribe; ownership changes only with the immutable tab maps.
    if (terminalTabs !== state.tabsByWorktree || unifiedTabs !== state.unifiedTabsByWorktree) {
      owner = findNativeChatTabOwnerWorktreeId(state, tabId)
      terminalTabs = state.tabsByWorktree
      unifiedTabs = state.unifiedTabsByWorktree
    }
    return owner
  }
}

export function resolveNativeChatFileLinkContext(
  state: NativeChatFileLinkState,
  terminalTabId: string
): NativeChatFileLinkContext | null {
  return resolveNativeChatFileLinkContextForOwner(
    state,
    terminalTabId,
    findNativeChatTabOwnerWorktreeId(state, terminalTabId)
  )
}

export function createNativeChatFileLinkContextSelector(tabId: string) {
  const selectOwner = createNativeChatTabOwnerSelector(tabId)
  const keys = [
    'tabsByWorktree',
    'unifiedTabsByWorktree',
    'settings',
    'repos',
    'worktreesByRepo',
    'detectedWorktreesByRepo',
    'folderWorkspaces',
    'projectGroups',
    'getKnownWorktreeById',
    'floatingWorkspacePath',
    'structuredSessionLaunchDirectoryByTabId'
  ] as const
  let previous: NativeChatFileLinkState | null = null
  let context: NativeChatFileLinkContext | null = null
  return (state: NativeChatFileLinkState) => {
    if (!previous || keys.some((key) => previous![key] !== state[key])) {
      context = resolveNativeChatFileLinkContextForOwner(state, tabId, selectOwner(state))
      previous = state
    }
    return context
  }
}

function resolveNativeChatFileLinkContextForOwner(
  state: NativeChatFileLinkState,
  terminalTabId: string,
  worktreeId: string | null
): NativeChatFileLinkContext | null {
  if (!worktreeId) {
    return null
  }
  const structuredTab = state.unifiedTabsByWorktree?.[worktreeId]?.find(
    (tab) => tab.id === terminalTabId && tab.contentType === 'agent-session'
  )
  const structured = structuredTab ? { bucket: worktreeId, tab: structuredTab } : undefined
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
    resolveNativeChatTabDirectory(state, terminalTabId, worktreeId) ??
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
  if (route.pathKind === 'literal') {
    const absolutePath = resolveExplicitFileLinkTargetPath(route.pathText, context.worktreePath)
    return absolutePath ? { absolutePath, line: null, column: null } : null
  }
  return resolvePathText(route.pathText, route.line, context)
}
