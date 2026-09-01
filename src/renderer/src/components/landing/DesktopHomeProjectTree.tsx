/* eslint-disable max-lines -- The recursive space tree keeps drag/drop and expansion behavior together. */

import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Cloud,
  Folder,
  FolderTree,
  GitBranch,
  MessageCircle,
  Pin,
  Plus,
  Server,
  WifiOff
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import {
  formatHomeRelativeTime,
  type DesktopHomeProject,
  type DesktopHomeProjectGroup,
  type DesktopHomeSession,
  type DesktopHomeWorkspace,
  type HomeRelativeTimeLabels
} from './desktop-home-model'
import {
  hasDesktopHomeSessionDragData,
  readDesktopHomeSessionDragData
} from './desktop-home-session-drag'

type DesktopHomeProjectTreeProps = {
  groups: readonly DesktopHomeProjectGroup[]
  activeWorkspaceIdentity: string | null
  timeLabels: HomeRelativeTimeLabels
  onToggleGroup: (collapseKey: string) => void
  onCreateWorkspace: (project: DesktopHomeProject | null, group?: DesktopHomeProjectGroup) => void
  onActivate: (workspace: DesktopHomeWorkspace) => void
  temporarySessions: readonly DesktopHomeSession[]
  pendingSession: DesktopHomeSession | null
  onActivateSession: (session: DesktopHomeSession) => void
  onSaveTemporarySession: (
    session: DesktopHomeSession,
    target?: DesktopHomeProject | DesktopHomeProjectGroup
  ) => void
}

function resolveDraggedSession(
  payload: ReturnType<typeof readDesktopHomeSessionDragData>,
  sessions: readonly DesktopHomeSession[]
): DesktopHomeSession | null {
  if (!payload) {
    return null
  }
  const existing = sessions.find(
    (entry) =>
      entry.id === payload.sessionId &&
      (!payload.executionHostId || entry.executionHostId === payload.executionHostId)
  )
  if (existing) {
    return existing
  }
  // Sidebar status rows can be published before the richer landing projection
  // hydrates. The drag payload is still a validated, temporary-session identity;
  // preserve it instead of dropping the gesture on a transient loading gap.
  return {
    id: payload.sessionId,
    title: payload.title,
    scope: null,
    status: 'running',
    lastActivityAt: 0,
    ...(payload.tabId ? { restoreTabId: payload.tabId } : {}),
    ...(payload.executionHostId ? { executionHostId: payload.executionHostId } : {})
  }
}

function collectExpandedProjectKeys(
  groups: readonly DesktopHomeProjectGroup[]
): ReadonlySet<string> {
  const keys = new Set<string>()
  const visit = (group: DesktopHomeProjectGroup): void => {
    for (const project of group.projects) {
      if (project.workspaceCount > 0 || project.sessions.length > 0) {
        keys.add(project.identityKey)
      }
    }
    for (const child of group.childGroups) {
      visit(child)
    }
  }
  for (const group of groups) {
    visit(group)
  }
  return keys
}

function ProjectSessionRow({
  session,
  timeLabels,
  onActivate
}: {
  session: DesktopHomeSession
  timeLabels: HomeRelativeTimeLabels
  onActivate: (session: DesktopHomeSession) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="desktop-home-tree-workspace"
      onClick={() => onActivate(session)}
      data-session-id={session.id}
    >
      <span className="desktop-home-tree-workspace-icon" aria-hidden>
        <MessageCircle />
      </span>
      <span className="desktop-home-tree-workspace-copy">
        <span className="desktop-home-tree-workspace-name">{session.title}</span>
        <span className="desktop-home-tree-workspace-meta">
          {translate('components.desktopHome.savedSession', 'Saved session')}
        </span>
      </span>
      <span className="desktop-home-tree-workspace-time">
        {formatHomeRelativeTime(session.lastActivityAt, Date.now(), timeLabels)}
      </span>
      <ChevronRight className="desktop-home-tree-row-chevron" aria-hidden />
    </button>
  )
}

function workspaceStatusIcon(status: DesktopHomeWorkspace['status']) {
  if (status === 'offline') {
    return WifiOff
  }
  if (status === 'error') {
    return CircleAlert
  }
  if (status === 'completed') {
    return CircleCheck
  }
  if (status === 'running' || status === 'waiting') {
    return Activity
  }
  return null
}

function HostIcon({ workspace }: { workspace: DesktopHomeWorkspace }): React.JSX.Element {
  if (workspace.hostLabel === 'cloud') {
    return <Cloud className="desktop-home-tree-meta-icon" aria-hidden />
  }
  if (workspace.hostLabel === 'ssh') {
    return <Server className="desktop-home-tree-meta-icon" aria-hidden />
  }
  return <GitBranch className="desktop-home-tree-meta-icon" aria-hidden />
}

function WorkspaceRow({
  workspace,
  active,
  timeLabels,
  onActivate
}: {
  workspace: DesktopHomeWorkspace
  active: boolean
  timeLabels: HomeRelativeTimeLabels
  onActivate: (workspace: DesktopHomeWorkspace) => void
}): React.JSX.Element {
  const StatusIcon = workspaceStatusIcon(workspace.status)
  return (
    <button
      type="button"
      className={cn(
        'desktop-home-tree-workspace',
        active && 'is-active',
        workspace.isUnread && 'is-unread'
      )}
      onClick={() => onActivate(workspace)}
      title={workspace.path}
      data-workspace-identity={workspace.identityKey}
    >
      <span className="desktop-home-tree-workspace-icon" aria-hidden>
        {workspace.kind === 'folder' ? <Folder /> : <GitBranch />}
      </span>
      <span className="desktop-home-tree-workspace-copy">
        <span className="desktop-home-tree-workspace-name">
          {workspace.name}
          {workspace.isPinned ? (
            <Pin
              className="desktop-home-tree-pin"
              aria-label={translate('components.desktopHome.pinned', 'Pinned')}
            />
          ) : null}
          {workspace.isUnread ? (
            <span
              className="desktop-home-tree-unread-dot"
              aria-label={translate('components.desktopHome.unread', 'Unread')}
            />
          ) : null}
        </span>
        <span className="desktop-home-tree-workspace-meta">
          <span className="desktop-home-tree-branch">{workspace.branch}</span>
          <span aria-hidden>·</span>
          <HostIcon workspace={workspace} />
          <span>
            {translate(`components.desktopHome.host.${workspace.hostLabel}`, workspace.hostLabel)}
          </span>
          {workspace.sessions.length > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {translate('components.desktopHome.sessionCount', '{{count}} sessions', {
                  count: workspace.sessions.length
                })}
              </span>
            </>
          ) : null}
          {StatusIcon ? (
            <StatusIcon
              className={cn(
                'desktop-home-tree-status-icon',
                workspace.status === 'error' && 'is-error',
                workspace.status === 'offline' && 'is-offline',
                workspace.status === 'running' && 'is-running'
              )}
              aria-label={workspace.statusLabel ?? workspace.status}
            />
          ) : null}
        </span>
      </span>
      <span className="desktop-home-tree-workspace-time">
        {formatHomeRelativeTime(workspace.lastActivityAt, Date.now(), timeLabels)}
      </span>
      <ChevronRight className="desktop-home-tree-row-chevron" aria-hidden />
    </button>
  )
}

function ProjectRow({
  project,
  expanded,
  onToggle,
  onCreateWorkspace,
  activeWorkspaceIdentity,
  timeLabels,
  onActivate,
  temporarySessions,
  pendingSession,
  onActivateSession,
  onSaveTemporarySession
}: {
  project: DesktopHomeProject
  expanded: boolean
  onToggle: () => void
  onCreateWorkspace: () => void
  activeWorkspaceIdentity: string | null
  timeLabels: HomeRelativeTimeLabels
  onActivate: (workspace: DesktopHomeWorkspace) => void
  temporarySessions: readonly DesktopHomeSession[]
  pendingSession: DesktopHomeSession | null
  onActivateSession: (session: DesktopHomeSession) => void
  onSaveTemporarySession: (
    session: DesktopHomeSession,
    target?: DesktopHomeProject | DesktopHomeProjectGroup
  ) => void
}): React.JSX.Element {
  const [dropActive, setDropActive] = useState(false)
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!hasDesktopHomeSessionDragData(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    // Own the gesture at the project boundary so the containing space cannot
    // process the same drop a second time. The whole project subtree is a
    // valid target, including one of its workspace rows.
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropActive(true)
  }
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }
    setDropActive(false)
  }
  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    setDropActive(false)
    const payload = readDesktopHomeSessionDragData(event.dataTransfer)
    if (!payload) {
      return
    }
    const session = resolveDraggedSession(payload, temporarySessions)
    if (session) {
      onSaveTemporarySession(session, project)
    }
  }
  return (
    <div
      className={cn('desktop-home-tree-project-wrap', dropActive && 'is-drop-target')}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-session-drop-target={dropActive ? 'project' : undefined}
    >
      <div className="desktop-home-tree-project-row">
        <button
          type="button"
          className="desktop-home-tree-project-main"
          onClick={() =>
            pendingSession ? onSaveTemporarySession(pendingSession, project) : onToggle()
          }
          data-session-save-target={pendingSession ? 'project' : undefined}
        >
          {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          <span
            className="desktop-home-tree-project-mark"
            style={{ backgroundColor: project.badgeColor ?? '#2f6bff' }}
            aria-hidden
          >
            {project.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="desktop-home-tree-project-name">{project.name}</span>
          <span className="desktop-home-tree-count">{project.workspaceCount}</span>
        </button>
        {!pendingSession ? (
          <button
            type="button"
            className="desktop-home-tree-action"
            onClick={onCreateWorkspace}
            aria-label={translate('components.desktopHome.newWorkspaceForProject', 'New workspace')}
            title={translate('components.desktopHome.newWorkspaceForProject', 'New workspace')}
          >
            <Plus aria-hidden />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="desktop-home-tree-project-children">
          {project.sessions.map((session) => (
            <ProjectSessionRow
              key={`${session.executionHostId ?? 'local'}|${session.id}`}
              session={session}
              timeLabels={timeLabels}
              onActivate={onActivateSession}
            />
          ))}
          {project.workspaces.length > 0 ? (
            project.workspaces.map((workspace) => (
              <WorkspaceRow
                key={workspace.identityKey}
                workspace={workspace}
                active={workspace.identityKey === activeWorkspaceIdentity}
                timeLabels={timeLabels}
                onActivate={onActivate}
              />
            ))
          ) : project.sessions.length === 0 ? (
            <button
              type="button"
              className="desktop-home-tree-empty-project"
              onClick={onCreateWorkspace}
            >
              <Plus aria-hidden />
              {translate('components.desktopHome.createFirstWorkspace', 'Create a workspace')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function GroupNode({
  group,
  depth,
  activeWorkspaceIdentity,
  expandedProjects,
  setExpandedProjects,
  onToggleGroup,
  onCreateWorkspace,
  onActivate,
  timeLabels,
  temporarySessions,
  pendingSession,
  onActivateSession,
  onSaveTemporarySession
}: {
  group: DesktopHomeProjectGroup
  depth: number
  activeWorkspaceIdentity: string | null
  expandedProjects: ReadonlySet<string>
  setExpandedProjects: (next: Set<string>) => void
  onToggleGroup: (collapseKey: string) => void
  onCreateWorkspace: (project: DesktopHomeProject | null, group?: DesktopHomeProjectGroup) => void
  onActivate: (workspace: DesktopHomeWorkspace) => void
  timeLabels: HomeRelativeTimeLabels
  temporarySessions: readonly DesktopHomeSession[]
  pendingSession: DesktopHomeSession | null
  onActivateSession: (session: DesktopHomeSession) => void
  onSaveTemporarySession: (
    session: DesktopHomeSession,
    target?: DesktopHomeProject | DesktopHomeProjectGroup
  ) => void
}): React.JSX.Element {
  const groupExpanded = !group.isCollapsed
  const displayName =
    group.id === '__ungrouped__'
      ? translate('components.desktopHome.ungrouped', 'Ungrouped')
      : group.name
  const hasDirectRows = group.folderWorkspaces.length > 0 || group.projects.length > 0
  const toggleProject = (identityKey: string): void => {
    const next = new Set(expandedProjects)
    if (next.has(identityKey)) {
      next.delete(identityKey)
    } else {
      next.add(identityKey)
    }
    setExpandedProjects(next)
  }
  return (
    <div
      className="desktop-home-tree-group"
      style={{ '--tree-depth': depth } as React.CSSProperties}
    >
      <div className="desktop-home-tree-group-row-wrap">
        <button
          type="button"
          className={cn('desktop-home-tree-group-row', group.isCollapsed && 'is-collapsed')}
          onClick={() => onToggleGroup(group.collapseKey)}
          aria-expanded={groupExpanded}
          aria-level={depth + 1}
        >
          {groupExpanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          <FolderTree aria-hidden />
          <span className="desktop-home-tree-group-name">{displayName}</span>
          <span className="desktop-home-tree-count">{group.workspaceCount}</span>
        </button>
        {!pendingSession ? (
          <button
            type="button"
            className="desktop-home-tree-action desktop-home-tree-group-action"
            onClick={() => onCreateWorkspace(null, group)}
            aria-label={translate('components.desktopHome.newWorkspaceForGroup', 'New workspace')}
            title={translate('components.desktopHome.newWorkspaceForGroup', 'New workspace')}
          >
            <Plus aria-hidden />
          </button>
        ) : null}
      </div>
      {groupExpanded ? (
        <div className="desktop-home-tree-group-children">
          {group.folderWorkspaces.map((workspace) => (
            <WorkspaceRow
              key={workspace.identityKey}
              workspace={workspace}
              active={workspace.identityKey === activeWorkspaceIdentity}
              timeLabels={timeLabels}
              onActivate={onActivate}
            />
          ))}
          {group.projects.map((project) => (
            <ProjectRow
              key={project.identityKey}
              project={project}
              expanded={expandedProjects.has(project.identityKey)}
              onToggle={() => toggleProject(project.identityKey)}
              onCreateWorkspace={() => onCreateWorkspace(project)}
              activeWorkspaceIdentity={activeWorkspaceIdentity}
              timeLabels={timeLabels}
              onActivate={onActivate}
              temporarySessions={temporarySessions}
              pendingSession={pendingSession}
              onActivateSession={onActivateSession}
              onSaveTemporarySession={onSaveTemporarySession}
            />
          ))}
          {group.childGroups.map((child) => (
            <GroupNode
              key={child.identityKey}
              group={child}
              depth={depth + 1}
              activeWorkspaceIdentity={activeWorkspaceIdentity}
              expandedProjects={expandedProjects}
              setExpandedProjects={setExpandedProjects}
              onToggleGroup={onToggleGroup}
              onCreateWorkspace={onCreateWorkspace}
              onActivate={onActivate}
              timeLabels={timeLabels}
              temporarySessions={temporarySessions}
              pendingSession={pendingSession}
              onActivateSession={onActivateSession}
              onSaveTemporarySession={onSaveTemporarySession}
            />
          ))}
          {!pendingSession && !hasDirectRows && group.childGroups.length === 0 ? (
            <button
              type="button"
              className="desktop-home-tree-empty-group"
              onClick={() => onCreateWorkspace(null, group)}
            >
              <Plus aria-hidden />
              {translate(
                'components.desktopHome.emptyGroupDescription',
                'This group has no workspaces yet'
              )}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function DesktopHomeProjectTree({
  groups,
  activeWorkspaceIdentity,
  timeLabels,
  onToggleGroup,
  onCreateWorkspace,
  onActivate,
  temporarySessions,
  pendingSession,
  onActivateSession,
  onSaveTemporarySession
}: DesktopHomeProjectTreeProps): React.JSX.Element {
  useTranslation()
  const projectKeysWithWorkspaces = useMemo(() => collectExpandedProjectKeys(groups), [groups])
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(projectKeysWithWorkspaces)
  )
  const knownProjectKeysRef = useRef<ReadonlySet<string>>(projectKeysWithWorkspaces)
  useEffect(() => {
    const newlyLoadedProjectKeys = [...projectKeysWithWorkspaces].filter(
      (key) => !knownProjectKeysRef.current.has(key)
    )
    knownProjectKeysRef.current = projectKeysWithWorkspaces
    if (newlyLoadedProjectKeys.length === 0) {
      return
    }
    setExpandedProjects((current) => {
      let changed = false
      const next = new Set(current)
      for (const key of newlyLoadedProjectKeys) {
        if (!next.has(key)) {
          next.add(key)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [projectKeysWithWorkspaces])
  return (
    <div
      className="desktop-home-tree"
      role="tree"
      aria-label={translate('components.desktopHome.projectTreeTitle', 'Projects and workspaces')}
    >
      {groups.map((group) => (
        <GroupNode
          key={group.identityKey}
          group={group}
          depth={0}
          activeWorkspaceIdentity={activeWorkspaceIdentity}
          expandedProjects={expandedProjects}
          setExpandedProjects={setExpandedProjects}
          onToggleGroup={onToggleGroup}
          onCreateWorkspace={onCreateWorkspace}
          onActivate={onActivate}
          timeLabels={timeLabels}
          temporarySessions={temporarySessions}
          pendingSession={pendingSession}
          onActivateSession={onActivateSession}
          onSaveTemporarySession={onSaveTemporarySession}
        />
      ))}
    </div>
  )
}
