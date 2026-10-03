// @vitest-environment happy-dom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  repo,
  worktree,
  project,
  projectHostSetups
} from '../../worktree-list-groups-test-fixtures'
import type { ProjectGroupingModel } from '../grouping/project-grouping'
import {
  buildRuntimeOfflineRows,
  appendRuntimeOfflineDirectory
} from '../grouping/runtime-offline-rows'
import { OFFLINE_RUNTIME_GROUP_KEY } from '../grouping/group-keys'
import { getWorktreeOptionId } from '../rows/option-dom'
import type { PendingSidebarRevealArgs } from './pending-reveal-inputs'
import { expandGroupsForWorktreeReveal } from './pending-reveal-inputs'
import { usePendingSidebarReveal } from './use-pending-reveal'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ setRenamingWorktreeId: vi.fn() })
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const remoteRepo: Repo = { ...repo, id: 'remote-repo', executionHostId: 'runtime:remote' }
const remoteTree = {
  ...worktree,
  id: 'remote-tree',
  repoId: remoteRepo.id,
  hostId: 'runtime:remote' as const
}
const offlineIds = new Set(['remote'])
const repoMap = new Map([
  [repo.id, repo],
  [remoteRepo.id, remoteRepo]
])
const frames: FrameRequestCallback[] = []
const flash = vi.fn()
const clearRow = vi.fn()
const scrollToIndex = vi.fn()
const toggle = vi.fn()
let container: HTMLDivElement
let root: Root

function args(): PendingSidebarRevealArgs {
  return {
    pendingRevealWorktree: null,
    pendingRevealSidebarRow: null,
    clearPendingRevealWorktreeId: vi.fn(),
    clearPendingRevealSidebarRow: clearRow,
    agentSendTargetWorktreeId: null,
    renderRows: [],
    virtualizer: { scrollToIndex } as never,
    scrollRef: { current: container },
    worktrees: [worktree, remoteTree],
    folderWorkspaces: [],
    repoMap,
    worktreeMap: new Map([
      [worktree.id, worktree],
      [remoteTree.id, remoteTree]
    ]),
    worktreeLineageById: {},
    collapsedGroups: new Set(),
    toggleGroup: toggle,
    groupBy: 'repo',
    pinnedDisplayPolicy: 'single-location',
    defaultHostId: 'local',
    prCache: null,
    workspaceStatuses: [],
    settings: null,
    projectGroups: [],
    offlineRuntimeEnvironmentIds: offlineIds,
    flashRevealedRow: flash,
    markRevealScroll: vi.fn(),
    schedulePendingRevealFrame: (callback) => {
      frames.push(callback)
    },
    cancelPendingRevealFrames: () => {
      frames.length = 0
    }
  }
}

function renderProbe(
  rowKey: string,
  collapsed: boolean,
  includeOnline = false,
  projectGrouping?: ProjectGroupingModel
): void {
  function Probe() {
    const [collapsedGroups, setCollapsedGroups] = useState(
      new Set(collapsed ? [OFFLINE_RUNTIME_GROUP_KEY] : [])
    )
    const rowArgs: Parameters<typeof buildRuntimeOfflineRows>[0] = [
      'repo',
      includeOnline ? [worktree, remoteTree] : [remoteTree],
      includeOnline ? repoMap : new Map([[remoteRepo.id, remoteRepo]]),
      null,
      collapsedGroups
    ]
    rowArgs[17] = projectGrouping
    const result = buildRuntimeOfflineRows(rowArgs, offlineIds)
    const renderRows = appendRuntimeOfflineDirectory(
      result.onlineRows,
      result.offlineRows,
      result.offlineCount,
      collapsedGroups
    )
    usePendingSidebarReveal({
      ...args(),
      collapsedGroups,
      renderRows,
      projectGrouping,
      pendingRevealSidebarRow: { rowKey, behavior: 'auto', highlight: true },
      toggleGroup: (key) => {
        toggle(key)
        setCollapsedGroups((current) => {
          const next = new Set(current)
          if (next.has(key)) {
            next.delete(key)
          } else {
            next.add(key)
          }
          return next
        })
      }
    })
    return renderRows.map((row) =>
      row.type === 'header' ? (
        <div key={row.renderKey ?? row.key} id={getWorktreeOptionId(row.renderKey ?? row.key)}>
          {row.label}
        </div>
      ) : null
    )
  }
  act(() => root.render(<Probe />))
  for (
    let index = 0;
    index < 12 && frames.length > 0 && clearRow.mock.calls.length === 0;
    index++
  ) {
    const callback = frames.shift()!
    act(() => callback(index))
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  frames.length = 0
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('offline sidebar reveal', () => {
  const model: ProjectGroupingModel = {
    projects: [{ ...project, sourceRepoIds: [repo.id, remoteRepo.id] }],
    projectHostSetups: [
      projectHostSetups[0],
      {
        ...projectHostSetups[1],
        id: remoteRepo.id,
        repoId: remoteRepo.id,
        hostId: 'runtime:remote'
      }
    ]
  }

  it('reveals a projected project header when search still targets its repository', () => {
    const projectId = `repo:${remoteRepo.id}`
    renderProbe(`repo:${remoteRepo.id}`, true, false, {
      projects: [{ ...project, id: projectId, sourceRepoIds: [remoteRepo.id] }],
      projectHostSetups: [{ ...model.projectHostSetups[1], projectId }]
    })
    expect(flash).toHaveBeenCalledWith(`${OFFLINE_RUNTIME_GROUP_KEY}:project:${projectId}`)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('opens an offline-only project even when the catalog also contains its local checkout', () => {
    renderProbe(`project:${project.id}`, true, false, model)
    expect(toggle).toHaveBeenCalledWith(OFFLINE_RUNTIME_GROUP_KEY)
    expect(flash).toHaveBeenCalledWith(`${OFFLINE_RUNTIME_GROUP_KEY}:project:${project.id}`)
  })

  it('reveals the online header without opening its folded offline copy', () => {
    renderProbe(`project:${project.id}`, true, true, model)
    expect(toggle).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith(`project:${project.id}`)
  })

  it('reveals an explicitly selected offline header when an online copy also exists', () => {
    renderProbe(`${OFFLINE_RUNTIME_GROUP_KEY}:project:${project.id}`, true, true, model)
    expect(toggle).toHaveBeenCalledWith(OFFLINE_RUNTIME_GROUP_KEY)
    expect(flash).toHaveBeenCalledWith(`${OFFLINE_RUNTIME_GROUP_KEY}:project:${project.id}`)
  })

  it('opens the directory and highlights the mounted offline project', () => {
    renderProbe(`repo:${remoteRepo.id}`, true)
    expect(toggle).toHaveBeenCalledWith(OFFLINE_RUNTIME_GROUP_KEY)
    expect(flash).toHaveBeenCalledWith(`${OFFLINE_RUNTIME_GROUP_KEY}:repo:${remoteRepo.id}`)
    expect(clearRow).toHaveBeenCalledTimes(1)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('reveals the mounted offline header even when its directory is already expanded', () => {
    renderProbe(`repo:${remoteRepo.id}`, false)
    expect(flash).toHaveBeenCalledWith(`${OFFLINE_RUNTIME_GROUP_KEY}:repo:${remoteRepo.id}`)
    expect(scrollToIndex).not.toHaveBeenCalled()
  })

  it('keeps the offline directory folded when revealing an online project', () => {
    renderProbe(`repo:${repo.id}`, true, true)
    expect(toggle).not.toHaveBeenCalled()
    expect(flash).toHaveBeenCalledWith(`repo:${repo.id}`)
  })

  it('opens the directory when revealing an offline runtime worktree', () => {
    expandGroupsForWorktreeReveal(
      { ...args(), collapsedGroups: new Set([OFFLINE_RUNTIME_GROUP_KEY]) },
      remoteTree.id,
      remoteTree.hostId
    )
    expect(toggle).toHaveBeenCalledWith(OFFLINE_RUNTIME_GROUP_KEY)
  })

  it('opens the directory for an SSH worktree owned by an offline runtime', () => {
    const sshTree = {
      ...remoteTree,
      hostId: 'ssh:nested' as const,
      runtimeOwnerEnvironmentId: 'remote'
    }
    expandGroupsForWorktreeReveal(
      { ...args(), worktrees: [sshTree], collapsedGroups: new Set([OFFLINE_RUNTIME_GROUP_KEY]) },
      sshTree.id,
      sshTree.hostId
    )
    expect(toggle).toHaveBeenCalledWith(OFFLINE_RUNTIME_GROUP_KEY)
  })

  it('does not open the directory for standalone SSH worktrees', () => {
    const sshTree = { ...worktree, hostId: 'ssh:standalone' as const }
    expandGroupsForWorktreeReveal(
      { ...args(), worktrees: [sshTree], collapsedGroups: new Set([OFFLINE_RUNTIME_GROUP_KEY]) },
      sshTree.id,
      sshTree.hostId
    )
    expect(toggle).not.toHaveBeenCalled()
  })
})
