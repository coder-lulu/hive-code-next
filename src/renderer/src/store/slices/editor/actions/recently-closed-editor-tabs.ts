import { releaseEditorUntitledPlaceholder } from '@/components/editor/editor-untitled-placeholder'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import {
  createRecentlyClosedTabPositionIndex,
  pushRecentlyClosedTabKind,
  restoreRecentlyClosedTabPosition
} from '../../recently-closed-tabs'
import { notifyHostOfMirroredEditorClose } from '@/runtime/close-mirrored-editor-tab'
import { type OpenFile, MAX_RECENT_CLOSED_EDITOR_TABS } from '../types/open-file'
import { getUntitledFileCleanupResult } from '../tabs/untitled-file-cleanup'
import { unifiedTabsKeepWorktreeSelected } from './unified-tabs-keep-worktree-selected'

export function createRecentlyClosedEditorTabs(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'reopenClosedEditorTab' | 'closeAllFiles'> {
  return {
    reopenClosedEditorTab: (worktreeId) => {
      const stack = get().recentlyClosedEditorTabsByWorktree[worktreeId] ?? []
      const next = stack[0]
      if (!next) {
        return false
      }
      set((s) => ({
        recentlyClosedEditorTabsByWorktree: {
          ...s.recentlyClosedEditorTabsByWorktree,
          [worktreeId]: (s.recentlyClosedEditorTabsByWorktree[worktreeId] ?? []).slice(1)
        }
      }))
      const { position, reopenId, ...file } = next
      const restoredFileId = get().openFile(file, {
        targetGroupId: position?.groupId,
        reopenId
      })
      restoreRecentlyClosedTabPosition(get, worktreeId, restoredFileId, position)
      return true
    },

    closeAllFiles: () => {
      const state = get()
      const activeWorktreeId = state.activeWorktreeId

      const closingFiles = state.openFiles.filter(
        (file) => !activeWorktreeId || file.worktreeId === activeWorktreeId
      )
      const cleanupResults = closingFiles.flatMap((file) => {
        const result = getUntitledFileCleanupResult(file, !!state.editorDrafts[file.id])
        return result ? [result] : []
      })
      // Why: close-all bypasses closeFile, so notify mirrored host-owned editors here or the next host snapshot reopens them.
      for (const file of closingFiles) {
        releaseEditorUntitledPlaceholder(state, file)
        notifyHostOfMirroredEditorClose(state, file.worktreeId, file.id)
      }

      const closingItemIds = Object.values(state.unifiedTabsByWorktree ?? {})
        .flat()
        .filter(
          (item) =>
            (item.contentType === 'editor' ||
              item.contentType === 'diff' ||
              item.contentType === 'conflict-review' ||
              item.contentType === 'check-details') &&
            (!activeWorktreeId || item.worktreeId === activeWorktreeId)
        )
        .map((item) => item.id)
      set((s) => {
        const activeWorktreeId = s.activeWorktreeId
        const closedFilesByWorktree = new Map<string, OpenFile[]>()
        for (const file of s.openFiles) {
          if (activeWorktreeId && file.worktreeId !== activeWorktreeId) {
            continue
          }
          const files = closedFilesByWorktree.get(file.worktreeId)
          if (files) {
            files.push(file)
          } else {
            closedFilesByWorktree.set(file.worktreeId, [file])
          }
        }
        const nextRecentClosed = { ...s.recentlyClosedEditorTabsByWorktree }
        let nextRecentKinds = s.recentlyClosedTabKindsByWorktree
        for (const [worktreeId, files] of closedFilesByWorktree) {
          let stack = nextRecentClosed[worktreeId] ?? []
          let capturedCloseCount = 0
          // One index per owner avoids repeatedly scanning tab order and group membership.
          const positionIndex = createRecentlyClosedTabPositionIndex(s, worktreeId)
          for (const file of files.toReversed()) {
            if (file.mode === 'markdown-preview') {
              continue
            }
            const {
              id: _id,
              isDirty: _dirty,
              mirroredFromRuntimeSession: _mirrored,
              untitledPlaceholderLeaseToken: _lease,
              ...snap
            } = file
            const position = positionIndex.positionFor(file.id)
            stack = [
              { ...snap, reopenId: file.id, ...(position ? { position } : {}) },
              ...stack
            ].slice(0, MAX_RECENT_CLOSED_EDITOR_TABS)
            capturedCloseCount += 1
          }
          nextRecentClosed[worktreeId] = stack
          nextRecentKinds = pushRecentlyClosedTabKind(
            nextRecentKinds,
            worktreeId,
            'editor',
            capturedCloseCount
          )
        }
        if (!activeWorktreeId) {
          return {
            openFiles: [],
            editorDrafts: {},
            editorCursorLine: {},
            activeFileId: null,
            activeTabType: 'terminal',
            markdownViewMode: {},
            markdownRichModeSizeOverride: {},
            editorViewMode: {},
            markdownFrontmatterVisible: {},
            markdownTableOfContentsVisible: {},
            pendingEditorReveal: null,
            pendingEditorFocusRequest: null,
            recentlyClosedEditorTabsByWorktree: nextRecentClosed,
            recentlyClosedTabKindsByWorktree: nextRecentKinds
          }
        }
        // Only close files for the current worktree
        const newFiles = s.openFiles.filter((f) => f.worktreeId !== activeWorktreeId)
        const remainingFileIds = new Set(newFiles.map((f) => f.id))
        const newEditorDrafts = Object.fromEntries(
          Object.entries(s.editorDrafts).filter(([fileId]) => remainingFileIds.has(fileId))
        )
        const newMarkdownViewMode = Object.fromEntries(
          Object.entries(s.markdownViewMode).filter(([fileId]) => remainingFileIds.has(fileId))
        )
        const newMarkdownRichModeSizeOverride = Object.fromEntries(
          Object.entries(s.markdownRichModeSizeOverride).filter(([fileId]) =>
            remainingFileIds.has(fileId)
          )
        )
        const newEditorViewMode = Object.fromEntries(
          Object.entries(s.editorViewMode).filter(([fileId]) => remainingFileIds.has(fileId))
        )
        const newMarkdownFrontmatterVisible = Object.fromEntries(
          Object.entries(s.markdownFrontmatterVisible).filter(([fileId]) =>
            remainingFileIds.has(fileId)
          )
        )
        const newMarkdownTableOfContentsVisible = Object.fromEntries(
          Object.entries(s.markdownTableOfContentsVisible).filter(([fileId]) =>
            remainingFileIds.has(fileId)
          )
        )
        const newEditorCursorLine = Object.fromEntries(
          Object.entries(s.editorCursorLine).filter(([fileId]) => remainingFileIds.has(fileId))
        )
        const newActiveFileIdByWorktree = { ...s.activeFileIdByWorktree }
        delete newActiveFileIdByWorktree[activeWorktreeId]
        const newActiveTabTypeByWorktree = { ...s.activeTabTypeByWorktree }
        const browserTabsForWorktree = s.browserTabsByWorktree[activeWorktreeId] ?? []
        const terminalTabsForWorktree = s.tabsByWorktree[activeWorktreeId] ?? []
        newActiveTabTypeByWorktree[activeWorktreeId] =
          browserTabsForWorktree.length > 0 ? 'browser' : 'terminal'
        // Why: mirrored tabs use host tab ids in tab order while local entries use file ids; remove both shapes.
        const closedFileIds = new Set(
          s.openFiles.filter((f) => f.worktreeId === activeWorktreeId).map((f) => f.id)
        )
        const closedTabOrderIds = new Set([...closedFileIds, ...closingItemIds])
        const shouldDeactivateWorktree =
          browserTabsForWorktree.length === 0 &&
          terminalTabsForWorktree.length === 0 &&
          !unifiedTabsKeepWorktreeSelected(
            s.unifiedTabsByWorktree?.[activeWorktreeId],
            closedTabOrderIds
          )
        const nextTabBarOrderByWorktree = s.tabBarOrderByWorktree
          ? {
              ...s.tabBarOrderByWorktree,
              [activeWorktreeId]: (s.tabBarOrderByWorktree[activeWorktreeId] ?? []).filter(
                (entryId) => !closedTabOrderIds.has(entryId)
              )
            }
          : s.tabBarOrderByWorktree

        return {
          openFiles: newFiles,
          editorDrafts: newEditorDrafts,
          editorCursorLine: newEditorCursorLine,
          activeFileId: null,
          // Why: closing every editor can leave no renderable surface; clear the active worktree so the renderer shows the landing page, not a blank workspace.
          activeWorktreeId: shouldDeactivateWorktree ? null : s.activeWorktreeId,
          activeBrowserTabId: shouldDeactivateWorktree
            ? null
            : browserTabsForWorktree.length > 0
              ? (s.activeBrowserTabIdByWorktree[activeWorktreeId] ??
                browserTabsForWorktree[0]?.id ??
                null)
              : s.activeBrowserTabId,
          activeTabType: browserTabsForWorktree.length > 0 ? 'browser' : 'terminal',
          markdownViewMode: newMarkdownViewMode,
          markdownRichModeSizeOverride: newMarkdownRichModeSizeOverride,
          editorViewMode: newEditorViewMode,
          markdownFrontmatterVisible: newMarkdownFrontmatterVisible,
          markdownTableOfContentsVisible: newMarkdownTableOfContentsVisible,
          activeFileIdByWorktree: newActiveFileIdByWorktree,
          activeTabTypeByWorktree: newActiveTabTypeByWorktree,
          tabBarOrderByWorktree: nextTabBarOrderByWorktree,
          // Why: clear the one-shot search reveal; keeping it after closing all editors would make a later reopen jump to an old match.
          pendingEditorReveal: null,
          pendingEditorFocusRequest:
            s.pendingEditorFocusRequest?.worktreeId === activeWorktreeId
              ? null
              : s.pendingEditorFocusRequest,
          recentlyClosedEditorTabsByWorktree: nextRecentClosed,
          recentlyClosedTabKindsByWorktree: nextRecentKinds
        }
      })
      for (const itemId of closingItemIds) {
        get().closeUnifiedTab?.(itemId)
      }
      return cleanupResults
    }
  }
}
