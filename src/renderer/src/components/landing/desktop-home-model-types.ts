import type { ExecutionHostId } from '../../../../shared/execution-host'
import type {
  FolderWorkspace,
  WorkspaceKey,
  WorkspaceScope
} from '../../../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../../../shared/project-group-types'
import type {
  Project,
  ProjectHostSetup,
  ProjectHostSetupState
} from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { SessionProjectAssignment } from '../../../../shared/session-project-assignment'

/** The small repo shape used by the landing projection and legacy callers. */
export type DesktopHomeRepo = Pick<Repo, 'id' | 'displayName' | 'path'> &
  Partial<
    Pick<
      Repo,
      'badgeColor' | 'connectionId' | 'executionHostId' | 'kind' | 'projectGroupId' | 'addedAt'
    >
  >

/** Worktree fields needed by the landing projection. */
export type DesktopHomeWorktree = Pick<Worktree, 'id' | 'repoId' | 'displayName' | 'path'> &
  Partial<
    Pick<
      Worktree,
      | 'branch'
      | 'hostId'
      | 'isMainWorktree'
      | 'isArchived'
      | 'isUnread'
      | 'isPinned'
      | 'workspaceStatus'
      | 'lastActivityAt'
      | 'createdAt'
    >
  >

export type DesktopHomeFolderWorkspace = Pick<
  FolderWorkspace,
  'id' | 'projectGroupId' | 'name' | 'folderPath'
> &
  Partial<
    Pick<
      FolderWorkspace,
      | 'connectionId'
      | 'executionHostId'
      | 'isArchived'
      | 'isUnread'
      | 'isPinned'
      | 'workspaceStatus'
      | 'lastActivityAt'
      | 'createdAt'
    >
  >

export type DesktopHomeProjectGroupSource = Pick<
  ProjectGroup,
  'id' | 'name' | 'parentGroupId' | 'tabOrder'
> &
  Partial<
    Pick<ProjectGroup, 'parentPath' | 'connectionId' | 'executionHostId' | 'isCollapsed' | 'color'>
  >

export type DesktopHomeProjectSource = Pick<Project, 'id' | 'displayName'> &
  Partial<Pick<Project, 'sourceRepoIds'>>

export type DesktopHomeProjectHostSetupSource = Pick<
  ProjectHostSetup,
  'id' | 'projectId' | 'repoId'
> &
  Partial<
    Pick<
      ProjectHostSetup,
      'hostId' | 'connectionId' | 'executionHostId' | 'setupMethod' | 'kind' | 'setupState'
    >
  >

/** Host/setup metadata projected onto a single homepage Project row. */
export type DesktopHomeProjectHostSetup = {
  id: string
  projectId: string
  repoId: string
  executionHostId: ExecutionHostId
  setupState?: ProjectHostSetupState
  setupMethod?: DesktopHomeProjectHostSetupSource['setupMethod']
  kind?: DesktopHomeProjectHostSetupSource['kind']
}

/** A deliberately loose tab projection so persisted legacy tabs remain readable. */
export type DesktopHomeTab = {
  id: string
  /** Optional owner copied from unified/legacy tab snapshots. */
  worktreeId?: string
  label?: string
  contentType?: string
  structuredSessionId?: string
  agentSessionAgent?: string
  /** Stable provider-backed session metadata mirrored from the unified tab model. */
  aiVaultTitle?: { sessionId?: string; title?: string } | null
  /** Agent tabs created through the legacy terminal launcher still have a stable tab id. */
  launchAgent?: string
  customLabel?: string | null
  generatedLabel?: string | null
  lastFocusedAt?: number
  createdAt?: number
  projectAssignment?: SessionProjectAssignment
}

export type DesktopHomeFile = {
  id: string
  worktreeId: string
  /** Optional host provenance for snapshots that span multiple runtimes. */
  executionHostId?: ExecutionHostId | null
  relativePath: string
  isDirty?: boolean
}

export type DesktopHomeSessionStatus = 'running' | 'waiting' | 'completed' | 'error'

export type DesktopHomeSession = {
  id: string
  title: string
  scope: WorkspaceScope | null
  /** Host-qualified owner used for React identity and unambiguous restoration. */
  workspaceIdentityKey?: string
  executionHostId?: ExecutionHostId
  status: DesktopHomeSessionStatus
  lastActivityAt: number
  restoreTabId?: string
  projectAssignment?: SessionProjectAssignment
}

export type DesktopHomeWorkspaceStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'error'
  | 'offline'

export type DesktopHomeWorkspace = {
  /** Raw id retained for activation compatibility; scope is in workspaceKey. */
  id: string
  workspaceKey: WorkspaceKey
  /** Host-qualified identity used by maps, React keys and de-duplication. */
  identityKey: string
  kind: 'worktree' | 'folder'
  repoId: string | null
  worktreeId?: string
  folderWorkspaceId?: string
  repoName: string
  name: string
  path: string
  branch: string
  badgeColor: string | null
  hostLabel: 'local' | 'ssh' | 'cloud'
  hostDisplayName?: string
  executionHostId: ExecutionHostId
  runtimeLabel?: string
  sessionCount: number
  sessions: DesktopHomeSession[]
  status: DesktopHomeWorkspaceStatus
  statusLabel?: string
  isUnread: boolean
  isPinned: boolean
  isMainWorktree?: boolean
  lastActivityAt: number
}

export type DesktopHomeProject = {
  id: string
  identityKey: string
  name: string
  /** All repository sources that belong to this logical project on this host. */
  hostDisplayName?: string
  repoIds: string[]
  repoId: string | null
  projectGroupId: string | null
  sourceType: 'git' | 'folder' | 'remote' | 'runtime'
  /** Sessions organized under this project while retaining their live owner. */
  sessions: DesktopHomeSession[]
  workspaces: DesktopHomeWorkspace[]
  workspaceCount: number
  lastActivityAt: number
  badgeColor: string | null
  executionHostId: ExecutionHostId
  /** Setups enrich the Project row; they never create additional rows. */
  hostSetups?: DesktopHomeProjectHostSetup[]
  setupState?: ProjectHostSetupState
}

export type DesktopHomeProjectGroup = {
  id: string
  identityKey: string
  name: string
  parentGroupId: string | null
  /** Folder root used by folder-backed spaces. Git-backed spaces leave this null. */
  parentPath: string | null
  childGroups: DesktopHomeProjectGroup[]
  projects: DesktopHomeProject[]
  folderWorkspaces: DesktopHomeWorkspace[]
  workspaceCount: number
  isCollapsed: boolean
  /** Same key consumed by Sidebar grouping's resolved collapsed set. */
  collapseKey: string
  executionHostId: ExecutionHostId
  /** True when the source group carried explicit host/connection provenance. */
  hasExplicitHost?: boolean
  color: string | null
  tabOrder?: number
}

export type HomeRelativeTimeLabels = {
  unused: string
  justNow: string
  minutesAgo: (value: number) => string
  hoursAgo: (value: number) => string
  daysAgo: (value: number) => string
}

export type DesktopHomeModel = {
  groups: DesktopHomeProjectGroup[]
  ungrouped: DesktopHomeProjectGroup
  projects: DesktopHomeProject[]
  workspaces: DesktopHomeWorkspace[]
  recentWorkspaces: DesktopHomeWorkspace[]
  currentWorkspace: DesktopHomeWorkspace | null
  currentFiles: DesktopHomeFile[]
  sessionSummaries: DesktopHomeSession[]
  /** Sessions owned by the global floating workspace, never a project/worktree. */
  temporarySessions: DesktopHomeSession[]
  projectCount: number
  workspaceCount: number
  sessionCount: number
}

export type BuildDesktopHomeModelInput = {
  repos: readonly DesktopHomeRepo[]
  worktreesByRepo: Readonly<Record<string, readonly DesktopHomeWorktree[] | undefined>>
  tabsByWorktree: Readonly<Record<string, readonly DesktopHomeTab[] | undefined>>
  /** Optional unified tab snapshot; used to retain agent-session identity during hydration. */
  unifiedTabsByWorktree?: Readonly<Record<string, readonly DesktopHomeTab[] | undefined>>
  openFiles: readonly DesktopHomeFile[]
  projectGroups?: readonly DesktopHomeProjectGroupSource[]
  folderWorkspaces?: readonly DesktopHomeFolderWorkspace[]
  projects?: readonly DesktopHomeProjectSource[]
  projectHostSetups?: readonly DesktopHomeProjectHostSetupSource[]
  activeWorkspaceKey?: string | null
  activeWorktreeId?: string | null
  activeRepoId?: string | null
  activeWorkspaceExecutionHostId?: ExecutionHostId | null
  /** Resolved Sidebar state; persisted group.isCollapsed is not read by home. */
  collapsedGroups?: ReadonlySet<string>
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
}
