export type DesktopHomeRepo = {
  id: string
  displayName: string
  path: string
  badgeColor?: string | null
  connectionId?: string | null
  executionHostId?: string | null
}

export type DesktopHomeWorktree = {
  id: string
  repoId: string
  displayName: string
  path: string
  branch?: string | null
  hostId?: string | null
  isMainWorktree?: boolean
  isArchived?: boolean
  lastActivityAt?: number | string | null
}

export type DesktopHomeTab = { id: string }
export type DesktopHomeFile = {
  id: string
  worktreeId: string
  relativePath: string
  isDirty?: boolean
}

export type DesktopHomeWorkspace = {
  id: string
  repoId: string
  repoName: string
  name: string
  path: string
  branch: string
  badgeColor: string | null
  hostLabel: '本地' | 'SSH' | '云端'
  sessionCount: number
  lastActivityAt: number
}

export type DesktopHomeModel = {
  recentWorkspaces: DesktopHomeWorkspace[]
  currentWorkspace: DesktopHomeWorkspace | null
  currentFiles: DesktopHomeFile[]
  projectCount: number
  workspaceCount: number
}

function timestamp(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value !== 'string') {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function branchLabel(branch: string | null | undefined, isMain: boolean | undefined): string {
  const normalized = branch?.replace(/^refs\/heads\//, '').trim()
  if (normalized) {
    return normalized
  }
  return isMain ? 'main' : '未命名分支'
}

function hostLabel(
  worktree: DesktopHomeWorktree,
  repo: DesktopHomeRepo
): DesktopHomeWorkspace['hostLabel'] {
  const host = worktree.hostId ?? repo.executionHostId ?? ''
  if (host.startsWith('runtime:')) {
    return '云端'
  }
  if (host.startsWith('ssh:') || repo.connectionId) {
    return 'SSH'
  }
  return '本地'
}

export function buildDesktopHomeModel(input: {
  repos: readonly DesktopHomeRepo[]
  worktreesByRepo: Readonly<Record<string, readonly DesktopHomeWorktree[] | undefined>>
  tabsByWorktree: Readonly<Record<string, readonly DesktopHomeTab[] | undefined>>
  openFiles: readonly DesktopHomeFile[]
}): DesktopHomeModel {
  const repoById = new Map(input.repos.map((repo) => [repo.id, repo]))
  const recentWorkspaces = Object.values(input.worktreesByRepo)
    .flatMap((worktrees) => worktrees ?? [])
    .filter((worktree) => !worktree.isArchived && repoById.has(worktree.repoId))
    .map((worktree): DesktopHomeWorkspace => {
      const repo = repoById.get(worktree.repoId)!
      return {
        id: worktree.id,
        repoId: repo.id,
        repoName: repo.displayName,
        name: worktree.displayName,
        path: worktree.path,
        branch: branchLabel(worktree.branch, worktree.isMainWorktree),
        badgeColor: repo.badgeColor ?? null,
        hostLabel: hostLabel(worktree, repo),
        sessionCount: input.tabsByWorktree[worktree.id]?.length ?? 0,
        lastActivityAt: timestamp(worktree.lastActivityAt)
      }
    })
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name))

  const currentWorkspace = recentWorkspaces[0] ?? null
  const currentFiles = currentWorkspace
    ? input.openFiles
        .filter((file) => file.worktreeId === currentWorkspace.id)
        .slice(-5)
        .toReversed()
    : []

  return {
    recentWorkspaces: recentWorkspaces.slice(0, 3),
    currentWorkspace,
    currentFiles,
    projectCount: input.repos.length,
    workspaceCount: recentWorkspaces.length
  }
}

export function formatHomeRelativeTime(value: number, now = Date.now()): string {
  if (!value) {
    return '尚未使用'
  }
  const minutes = Math.max(0, Math.floor((now - value) / 60_000))
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours} 小时前`
  }
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days} 天前` : new Date(value).toLocaleDateString('zh-CN')
}
