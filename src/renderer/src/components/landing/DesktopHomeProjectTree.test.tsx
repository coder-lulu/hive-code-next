// @vitest-environment happy-dom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopHomeProject,
  DesktopHomeProjectGroup,
  DesktopHomeSession
} from './desktop-home-model'
import DesktopHomeProjectTree from './DesktopHomeProjectTree'

afterEach(cleanup)

const timeLabels = {
  unused: 'Unused',
  justNow: 'Just now',
  minutesAgo: (value: number) => `${value}m`,
  hoursAgo: (value: number) => `${value}h`,
  daysAgo: (value: number) => `${value}d`
}

function project(sessions: DesktopHomeSession[] = []): DesktopHomeProject {
  return {
    id: 'project-1',
    identityKey: 'local|project:project-1',
    name: 'Project one',
    repoIds: ['repo-1'],
    repoId: 'repo-1',
    projectGroupId: 'space-1',
    sourceType: 'git',
    sessions,
    workspaces: [],
    workspaceCount: 0,
    lastActivityAt: 0,
    badgeColor: null,
    executionHostId: 'local'
  }
}

function group(projects: DesktopHomeProject[]): DesktopHomeProjectGroup {
  return {
    id: 'space-1',
    identityKey: 'local|project-group:space-1',
    name: 'Space one',
    parentPath: null,
    parentGroupId: null,
    childGroups: [],
    projects,
    folderWorkspaces: [],
    workspaceCount: 0,
    collapseKey: 'project-group:space-1',
    isCollapsed: false,
    executionHostId: 'local',
    hasExplicitHost: false,
    color: null,
    tabOrder: 0
  }
}

describe('DesktopHomeProjectTree session assignment', () => {
  it('requires a concrete project instead of selecting the first project in a space', () => {
    const pendingSession: DesktopHomeSession = {
      id: 'session-1',
      title: 'Temporary task',
      scope: null,
      status: 'waiting',
      lastActivityAt: 1,
      restoreTabId: 'tab-1'
    }
    const target = project()
    const onToggleGroup = vi.fn()
    const onSaveTemporarySession = vi.fn()
    const { container } = render(
      <DesktopHomeProjectTree
        groups={[group([target])]}
        activeWorkspaceIdentity={null}
        timeLabels={timeLabels}
        onToggleGroup={onToggleGroup}
        onCreateWorkspace={vi.fn()}
        onActivate={vi.fn()}
        temporarySessions={[pendingSession]}
        pendingSession={pendingSession}
        onActivateSession={vi.fn()}
        onSaveTemporarySession={onSaveTemporarySession}
      />
    )

    const spaceButton = container.querySelector<HTMLButtonElement>('.desktop-home-tree-group-row')
    expect(spaceButton).not.toBeNull()
    fireEvent.click(spaceButton!)
    expect(onToggleGroup).toHaveBeenCalledOnce()
    expect(onSaveTemporarySession).not.toHaveBeenCalled()

    const projectButton = container.querySelector<HTMLButtonElement>(
      '[data-session-save-target="project"]'
    )
    expect(projectButton).not.toBeNull()
    fireEvent.click(projectButton!)
    expect(onSaveTemporarySession).toHaveBeenCalledWith(pendingSession, target)
  })

  it('opens a project-assigned session through the supplied main-workbench activation', () => {
    const savedSession: DesktopHomeSession = {
      id: 'session-1',
      title: 'Saved task',
      scope: null,
      status: 'completed',
      lastActivityAt: 1,
      restoreTabId: 'tab-1'
    }
    const onActivateSession = vi.fn()
    const { container } = render(
      <DesktopHomeProjectTree
        groups={[group([project([savedSession])])]}
        activeWorkspaceIdentity={null}
        timeLabels={timeLabels}
        onToggleGroup={vi.fn()}
        onCreateWorkspace={vi.fn()}
        onActivate={vi.fn()}
        temporarySessions={[]}
        pendingSession={null}
        onActivateSession={onActivateSession}
        onSaveTemporarySession={vi.fn()}
      />
    )

    const sessionButton = container.querySelector<HTMLButtonElement>(
      '[data-session-id="session-1"]'
    )
    expect(sessionButton).not.toBeNull()
    fireEvent.click(sessionButton!)
    expect(onActivateSession).toHaveBeenCalledWith(savedSession)
  })
})
