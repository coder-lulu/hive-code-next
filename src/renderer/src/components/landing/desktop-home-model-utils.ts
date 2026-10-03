import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import {
  folderWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../../../../shared/workspace-scope'
import type { WorkspaceKey, WorkspaceScope } from '../../../../shared/folder-workspace-types'
import type {
  BuildDesktopHomeModelInput,
  DesktopHomeFolderWorkspace,
  DesktopHomeProject,
  DesktopHomeRepo,
  DesktopHomeSession,
  DesktopHomeSessionStatus,
  DesktopHomeTab,
  DesktopHomeWorkspace,
  DesktopHomeWorkspaceStatus,
  DesktopHomeWorktree,
  HomeRelativeTimeLabels
} from './desktop-home-model-types'
import { getIntlLocale } from '@/i18n/i18n'

export type HomeRepo = DesktopHomeRepo
export type HomeWorktree = DesktopHomeWorktree
export type HomeFolderWorkspace = DesktopHomeFolderWorkspace
export type HomeGroup = NonNullable<BuildDesktopHomeModelInput['projectGroups']>[number]

export function timestamp(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value !== 'string') {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function branchLabel(
  branch: string | null | undefined,
  isMain: boolean | undefined
): string {
  const normalized = branch?.replace(/^refs\/heads\//, '').trim()
  return normalized || (isMain ? 'main' : 'unnamed')
}

/** Resolve only IDs understood by the shared execution-host contract. */
export function normalizeHomeHostId(
  explicit: string | null | undefined,
  connectionId: string | null | undefined,
  fallback: ExecutionHostId = LOCAL_EXECUTION_HOST_ID
): ExecutionHostId {
  return (
    normalizeExecutionHostId(explicit) ??
    (connectionId?.trim() ? toSshExecutionHostId(connectionId.trim()) : fallback)
  )
}

export function hostLabel(host: ExecutionHostId): DesktopHomeWorkspace['hostLabel'] {
  if (host.startsWith('runtime:')) {
    return 'cloud'
  }
  if (host.startsWith('ssh:')) {
    return 'ssh'
  }
  return 'local'
}

export function sourceType(
  repo: HomeRepo,
  host: ExecutionHostId
): DesktopHomeProject['sourceType'] {
  if (host.startsWith('runtime:')) {
    return 'runtime'
  }
  if (host.startsWith('ssh:')) {
    return 'remote'
  }
  return repo.kind === 'folder' ? 'folder' : 'git'
}

export function statusFromValue(
  value: string | undefined,
  sessionCount: number,
  host: ExecutionHostId
): { status: DesktopHomeWorkspaceStatus; label?: string } {
  if (host.startsWith('runtime:') && value?.toLowerCase() === 'offline') {
    return { status: 'offline', label: value }
  }
  const normalized = value?.toLowerCase().replace(/[_\s-]+/g, '')
  if (!normalized) {
    return { status: sessionCount > 0 ? 'running' : 'idle' }
  }
  if (/(error|failed|blocked|broken)/.test(normalized)) {
    return { status: 'error', label: value }
  }
  if (/(wait|review|pending|paused)/.test(normalized)) {
    return { status: 'waiting', label: value }
  }
  if (/(done|complete|closed|merged)/.test(normalized)) {
    return { status: 'completed', label: value }
  }
  if (/(offline|unavailable|disconnected)/.test(normalized)) {
    return { status: 'offline', label: value }
  }
  if (/(progress|running|working|active)/.test(normalized)) {
    return { status: 'running', label: value }
  }
  return { status: sessionCount > 0 ? 'running' : 'idle', label: value }
}

function sessionStatus(tab: DesktopHomeTab): DesktopHomeSessionStatus {
  const label = `${tab.label ?? ''} ${tab.contentType ?? ''}`.toLowerCase()
  if (/(error|failed)/.test(label)) {
    return 'error'
  }
  if (/(wait|review|paused)/.test(label)) {
    return 'waiting'
  }
  if (/(done|complete|closed)/.test(label)) {
    return 'completed'
  }
  return 'running'
}

/**
 * Tabs are not automatically sessions. Only tabs carrying an agent/session
 * identity are projected, so editor and browser tabs cannot become fake
 * history rows.
 */
export function stableSessions(
  tabs: readonly DesktopHomeTab[] | undefined,
  scope: WorkspaceScope | null,
  fallbackActivity: number,
  owner?: {
    workspaceIdentityKey?: string
    executionHostId?: ExecutionHostId
  }
): DesktopHomeSession[] {
  const seen = new Set<string>()
  return (tabs ?? [])
    .filter(
      (tab) =>
        tab.contentType === 'agent-session' ||
        Boolean(tab.structuredSessionId) ||
        Boolean(tab.agentSessionAgent) ||
        Boolean(tab.launchAgent) ||
        Boolean(tab.aiVaultTitle?.sessionId)
    )
    .map((tab) => {
      const id = tab.structuredSessionId ?? tab.aiVaultTitle?.sessionId ?? tab.id
      return {
        id,
        title:
          tab.customLabel?.trim() ||
          tab.aiVaultTitle?.title?.trim() ||
          tab.generatedLabel?.trim() ||
          tab.label?.trim() ||
          'Agent session',
        scope,
        ...(owner?.workspaceIdentityKey
          ? { workspaceIdentityKey: owner.workspaceIdentityKey }
          : {}),
        ...(owner?.executionHostId ? { executionHostId: owner.executionHostId } : {}),
        status: sessionStatus(tab),
        lastActivityAt: timestamp(tab.lastFocusedAt ?? tab.createdAt) || fallbackActivity,
        restoreTabId: tab.id,
        ...(tab.projectAssignment ? { projectAssignment: tab.projectAssignment } : {})
      }
    })
    .filter((session) => {
      if (seen.has(session.id)) {
        return false
      }
      seen.add(session.id)
      return true
    })
    .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
}

export function workspaceIdentity(host: ExecutionHostId, key: WorkspaceKey): string {
  return `${host}|${key}`
}

export function groupIdentity(host: ExecutionHostId, id: string): string {
  return `${host}|project-group:${id}`
}

export function groupHost(group: HomeGroup): ExecutionHostId {
  return normalizeHomeHostId(group.executionHostId, group.connectionId)
}

export function compareWorkspace(left: DesktopHomeWorkspace, right: DesktopHomeWorkspace): number {
  return (
    Number(right.isPinned) - Number(left.isPinned) ||
    right.lastActivityAt - left.lastActivityAt ||
    Number(right.isMainWorktree) - Number(left.isMainWorktree) ||
    left.name.localeCompare(right.name)
  )
}

export function compareProject(left: DesktopHomeProject, right: DesktopHomeProject): number {
  return right.lastActivityAt - left.lastActivityAt || left.name.localeCompare(right.name)
}

export function compareGroup(
  left: { name: string; tabOrder?: number },
  right: { name: string; tabOrder?: number }
): number {
  return (
    (left.tabOrder ?? Number.MAX_SAFE_INTEGER) - (right.tabOrder ?? Number.MAX_SAFE_INTEGER) ||
    left.name.localeCompare(right.name)
  )
}

export function activeScope(input: BuildDesktopHomeModelInput): WorkspaceScope | null {
  const scoped = input.activeWorkspaceKey ? parseWorkspaceKey(input.activeWorkspaceKey) : null
  if (scoped) {
    return scoped
  }
  if (!input.activeWorktreeId) {
    return null
  }
  return (
    parseWorkspaceKey(input.activeWorktreeId) ?? {
      type: 'worktree',
      worktreeId: input.activeWorktreeId
    }
  )
}

export function workspaceScopeKey(scope: WorkspaceScope): WorkspaceKey {
  return scope.type === 'folder'
    ? folderWorkspaceKey(scope.folderWorkspaceId)
    : worktreeWorkspaceKey(scope.worktreeId)
}

export function tabsForWorkspace(
  tabsByWorktree: BuildDesktopHomeModelInput['tabsByWorktree'],
  workspace: Pick<DesktopHomeWorkspace, 'id' | 'workspaceKey' | 'identityKey' | 'executionHostId'>,
  options?: { allowLegacyRawKey?: boolean }
): readonly DesktopHomeTab[] {
  // Host-qualified keys are preferred for new snapshots. Raw/canonical keys
  // remain supported for persisted legacy state.
  const keys = [
    workspace.identityKey,
    `${workspace.executionHostId}|${workspace.id}`,
    workspace.workspaceKey
  ]
  if (options?.allowLegacyRawKey !== false) {
    keys.push(workspace.id)
  }
  for (const key of keys) {
    const tabs = tabsByWorktree[key]
    if (tabs) {
      return tabs
    }
  }
  return []
}

export function repoHost(repo: HomeRepo): ExecutionHostId {
  return getRepoExecutionHostId(repo)
}

export function formatHomeRelativeTime(
  value: number,
  now = Date.now(),
  labels?: HomeRelativeTimeLabels
): string {
  if (!value) {
    return labels?.unused ?? 'Not used yet'
  }
  const minutes = Math.max(0, Math.floor((now - value) / 60_000))
  if (minutes < 1) {
    return labels?.justNow ?? 'Just now'
  }
  if (minutes < 60) {
    return labels?.minutesAgo(minutes) ?? `${minutes} min ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return labels?.hoursAgo(hours) ?? `${hours} hr ago`
  }
  const days = Math.floor(hours / 24)
  return days < 30
    ? (labels?.daysAgo(days) ?? `${days} days ago`)
    : new Date(value).toLocaleDateString(getIntlLocale())
}
