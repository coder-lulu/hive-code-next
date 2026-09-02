import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../../shared/tab-types'
import type { WorkspaceSessionState } from '../../../../shared/workspace-session-state-types'
import { isValidTerminalTabId } from '../../../../shared/terminal-tab-id'
import { createBrowserUuid } from '@/lib/browser-uuid'

export type HydratedTabState = {
  unifiedTabsByWorktree: Record<string, Tab[]>
  groupsByWorktree: Record<string, TabGroup[]>
  activeGroupIdByWorktree: Record<string, string>
  layoutByWorktree: Record<string, TabGroupLayoutNode>
}

export function hydrateLegacyTabState(
  session: WorkspaceSessionState,
  validWorktreeIds: Set<string>
): HydratedTabState {
  const tabsByWorktree: Record<string, Tab[]> = {}
  const groupsByWorktree: Record<string, TabGroup[]> = {}
  const activeGroupIdByWorktree: Record<string, string> = {}
  const layoutByWorktree: Record<string, TabGroupLayoutNode> = {}

  for (const worktreeId of validWorktreeIds) {
    const terminalTabs = (session.tabsByWorktree[worktreeId] ?? []).filter((tab) =>
      isValidTerminalTabId(tab.id)
    )
    const editorFiles = session.openFilesByWorktree?.[worktreeId] ?? []
    if (terminalTabs.length === 0 && editorFiles.length === 0) {
      continue
    }

    const groupId = createBrowserUuid()
    const tabs: Tab[] = []
    const tabOrder: string[] = []
    for (const terminalTab of terminalTabs) {
      tabs.push({
        id: terminalTab.id,
        entityId: terminalTab.id,
        groupId,
        worktreeId,
        contentType: 'terminal',
        label: terminalTab.title,
        ...(terminalTab.quickCommandLabel?.trim()
          ? { quickCommandLabel: terminalTab.quickCommandLabel.trim() }
          : {}),
        ...(terminalTab.generatedTitle?.trim()
          ? { generatedLabel: terminalTab.generatedTitle.trim() }
          : {}),
        customLabel: terminalTab.customTitle,
        color: terminalTab.color,
        sortOrder: terminalTab.sortOrder,
        createdAt: terminalTab.createdAt,
        isPreview: false,
        isPinned: false
      })
      tabOrder.push(terminalTab.id)
    }
    for (const editorFile of editorFiles) {
      tabs.push({
        id: editorFile.filePath,
        entityId: editorFile.filePath,
        groupId,
        worktreeId,
        contentType: 'editor',
        label: editorFile.relativePath,
        customLabel: null,
        color: null,
        sortOrder: tabs.length,
        createdAt: Date.now(),
        isPreview: editorFile.isPreview,
        isPinned: false
      })
      tabOrder.push(editorFile.filePath)
    }

    const activeTabType = session.activeTabTypeByWorktree?.[worktreeId] ?? 'terminal'
    let activeTabId: string | null = null
    if (activeTabType === 'editor') {
      activeTabId = session.activeFileIdByWorktree?.[worktreeId] ?? null
    } else {
      // The global active tab belongs to the last-focused worktree, so each
      // restored worktree prefers its own remembered terminal first.
      const rememberedTabId = session.activeTabIdByWorktree?.[worktreeId]
      if (rememberedTabId && terminalTabs.some((tab) => tab.id === rememberedTabId)) {
        activeTabId = rememberedTabId
      } else if (
        session.activeTabId &&
        terminalTabs.some((tab) => tab.id === session.activeTabId)
      ) {
        activeTabId = session.activeTabId
      }
    }
    if (activeTabId && !tabs.some((tab) => tab.id === activeTabId)) {
      activeTabId = tabs[0]?.id ?? null
    }

    tabsByWorktree[worktreeId] = tabs
    groupsByWorktree[worktreeId] = [
      {
        id: groupId,
        worktreeId,
        activeTabId,
        tabOrder,
        recentTabIds: activeTabId ? [activeTabId] : []
      }
    ]
    activeGroupIdByWorktree[worktreeId] = groupId
    layoutByWorktree[worktreeId] = { type: 'leaf', groupId }
  }

  return {
    unifiedTabsByWorktree: tabsByWorktree,
    groupsByWorktree,
    activeGroupIdByWorktree,
    layoutByWorktree
  }
}
