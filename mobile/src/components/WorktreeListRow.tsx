import { memo } from 'react'
import { Bell, ChevronDown, ChevronRight, GitBranch, GitPullRequest } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { RepoIcon } from '../../../src/shared/repo-icon'
import type { AgentWorkingMode } from '../../../src/shared/agent-status-types'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { triggerMediumImpact } from '../platform/haptics'
import type { MobileTheme } from '../theme/mobile-theme'
import { AgentSpinner } from './AgentSpinner'
import { MobileRepoIcon } from './MobileRepoIcon'
import { WorktreeAgentList } from './WorktreeAgentList'
import { WorktreeMetaGlyphs, prStateColor } from './WorktreeMetaGlyphs'

// Strip the refs/heads/ prefix for display, matching the desktop sidebar
// (WorktreeCardHelpers.formatBranchName).
function displayBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, '')
}

// Minimal row shape needed for rendering — a structural subset of the screen's
// Worktree so this component stays decoupled from the screen's local type.
export type WorktreeListRowItem = {
  workspaceKind?: 'git' | 'folder-workspace'
  worktreeId: string
  repo: string
  branch: string
  displayName: string
  path?: string
  liveTerminalCount: number
  preview: string
  unread: boolean
  isActive?: boolean
  linkedPR: { number: number; state: string } | null
  linkedIssue?: number | null
  linkedLinearIssue?: string | null
  linkedGitLabMR?: number | null
  linkedGitLabIssue?: number | null
  comment?: string
  lineageDepth?: number
  lineageChildCount?: number
  lineageCollapsed?: boolean
  agents?: RuntimeWorktreeAgentRow[]
  workingMode?: AgentWorkingMode
}

type WorktreeRollupStatus = 'working' | 'active' | 'permission' | 'done' | 'inactive'

type Props<T extends WorktreeListRowItem> = {
  theme: MobileTheme
  item: T
  isReadOnly: boolean
  now: number
  repoColor: string
  repoIcon?: RepoIcon | null
  // When the list is already grouped under this repo's section header, the row
  // omits its own repo icon+name to avoid the redundant "📁 orca" on every row.
  hideRepo?: boolean
  status: WorktreeRollupStatus
  onPress: (item: T) => void
  onLongPress?: (item: T) => void
  onToggleLineage?: (item: T) => void
}

function WorktreeListRowComponent<T extends WorktreeListRowItem>({
  theme,
  item,
  isReadOnly,
  now,
  repoColor,
  repoIcon,
  hideRepo = false,
  status,
  onPress,
  onLongPress,
  onToggleLineage
}: Props<T>) {
  const styles = createStyles(theme)
  const isFolderWorkspace = item.workspaceKind === 'folder-workspace'
  const folderMeta = item.comment?.trim() || item.path || 'Folder'
  const metaText = isFolderWorkspace ? folderMeta : displayBranch(item.branch)
  const lineageDepth = Math.max(0, item.lineageDepth ?? 0)
  const lineageChildCount = item.lineageChildCount ?? 0

  return (
    <Pressable
      style={({ pressed }) => [
        styles.worktreeRow,
        lineageDepth > 0 && {
          paddingLeft: theme.spacing.space16 + lineageDepth * theme.spacing.space16
        },
        item.isActive && styles.worktreeRowActive,
        pressed && styles.worktreeRowPressed
      ]}
      disabled={isReadOnly}
      onPress={() => onPress(item)}
      onLongPress={
        onLongPress
          ? () => {
              triggerMediumImpact()
              onLongPress(item)
            }
          : undefined
      }
      delayLongPress={400}
    >
      <View style={styles.indicatorCol}>
        <AgentSpinner status={status} workingMode={item.workingMode} />
        {item.unread && (
          <Bell
            size={10}
            color={theme.color.status.warning}
            fill={theme.color.status.warning}
            style={styles.unreadBell}
          />
        )}
      </View>

      <View style={styles.worktreeMain}>
        <View style={styles.worktreeNameRow}>
          <Text
            style={[
              styles.worktreeName,
              item.unread && styles.worktreeNameUnread,
              isReadOnly && styles.textReadOnly
            ]}
            numberOfLines={1}
          >
            {item.displayName || item.repo}
          </Text>
          {item.linkedPR && (
            <View style={styles.prBadge}>
              <GitPullRequest size={10} color={prStateColor(item.linkedPR.state)} />
              <Text style={[styles.prNumber, { color: prStateColor(item.linkedPR.state) }]}>
                #{item.linkedPR.number}
              </Text>
            </View>
          )}
          {isFolderWorkspace && (
            <View style={styles.folderBadge}>
              <Text style={styles.folderBadgeText}>文件夹</Text>
            </View>
          )}
          <WorktreeMetaGlyphs
            theme={theme}
            comment={item.comment}
            linkedLinearIssue={item.linkedLinearIssue}
            linkedGitLabMR={item.linkedGitLabMR}
            linkedIssue={item.linkedIssue}
            linkedGitLabIssue={item.linkedGitLabIssue}
          />
        </View>
        <View style={styles.worktreeMetaRow}>
          {lineageDepth > 0 && (
            <View style={styles.childBadge}>
              <GitBranch size={10} color={theme.color.text.tertiary} />
              <Text style={styles.childBadgeText}>子工作区</Text>
            </View>
          )}
          {/* Repo glyph+name only when not already grouped under this repo;
              MobileRepoIcon falls back to a Folder (matching desktop's default)
              rather than a bare colored dot. */}
          {!hideRepo && (
            <>
              <MobileRepoIcon repoIcon={repoIcon} size={11} color={repoColor} />
              <Text style={styles.repoName} numberOfLines={1}>
                {item.repo}
              </Text>
            </>
          )}
          <Text style={styles.branchName} numberOfLines={1}>
            {metaText}
          </Text>
        </View>
        {/* Only agents get a secondary activity line, matching desktop. A plain
            terminal's shell-output tail is intentionally not surfaced here. */}
        {item.agents && item.agents.length > 0 ? (
          <WorktreeAgentList agents={item.agents} now={now} theme={theme} unvisited={item.unread} />
        ) : null}
        {lineageChildCount > 0 && onToggleLineage ? (
          <Pressable
            style={styles.lineageToggle}
            onPress={(event) => {
              event.stopPropagation()
              onToggleLineage(item)
            }}
          >
            {item.lineageCollapsed ? (
              <ChevronRight size={12} color={theme.color.text.secondary} />
            ) : (
              <ChevronDown size={12} color={theme.color.text.secondary} />
            )}
            <GitBranch size={12} color={theme.color.text.secondary} />
            <Text style={styles.lineageToggleText}>{lineageChildCount} 个子工作区</Text>
          </Pressable>
        ) : null}
      </View>

      {item.liveTerminalCount > 0 && (
        <Text style={styles.terminalCount}>{item.liveTerminalCount}</Text>
      )}
    </Pressable>
  )
}

export const WorktreeListRow = memo(WorktreeListRowComponent) as typeof WorktreeListRowComponent

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    worktreeRow: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingHorizontal: theme.spacing.space20,
      paddingVertical: theme.spacing.space12,
      borderLeftWidth: 2,
      borderLeftColor: 'transparent',
      backgroundColor: theme.color.bg.surface
    },
    worktreeRowPressed: { backgroundColor: theme.color.bg.subtle },
    worktreeRowActive: {
      borderLeftColor: theme.color.text.secondary,
      backgroundColor: theme.color.bg.subtle
    },
    indicatorCol: {
      width: theme.spacing.space20,
      alignItems: 'center',
      gap: theme.spacing.space4,
      marginRight: theme.spacing.space8,
      paddingTop: theme.spacing.space4
    },
    unreadBell: { marginTop: theme.spacing.space4 },
    worktreeMain: { flex: 1, marginRight: theme.spacing.space8 },
    worktreeNameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8
    },
    worktreeName: {
      ...theme.typography.label,
      flexShrink: 1,
      color: theme.color.text.primary,
      fontWeight: '600'
    },
    worktreeNameUnread: { fontWeight: '700' },
    textReadOnly: { opacity: 0.5 },
    prBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.subtle
    },
    prNumber: { ...theme.typography.caption, color: theme.color.text.secondary },
    folderBadge: {
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.subtle
    },
    folderBadgeText: { ...theme.typography.caption, color: theme.color.text.secondary },
    worktreeMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      marginTop: theme.spacing.space4
    },
    repoName: { ...theme.typography.caption, maxWidth: 100, color: theme.color.text.secondary },
    branchName: {
      ...theme.typography.code,
      flexShrink: 1,
      color: theme.color.text.secondary
    },
    childBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space4,
      borderRadius: theme.radii.small,
      backgroundColor: theme.color.bg.subtle
    },
    childBadgeText: { ...theme.typography.caption, color: theme.color.text.tertiary },
    lineageToggle: {
      minHeight: theme.size.minimumTouchTarget,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space4,
      marginTop: theme.spacing.space4,
      paddingHorizontal: theme.spacing.space8,
      borderRadius: theme.radii.control,
      backgroundColor: theme.color.bg.subtle
    },
    lineageToggleText: {
      ...theme.typography.caption,
      color: theme.color.text.secondary,
      fontWeight: '600'
    },
    terminalCount: {
      ...theme.typography.caption,
      minWidth: theme.spacing.space16,
      paddingTop: theme.spacing.space4,
      color: theme.color.text.secondary,
      textAlign: 'right'
    }
  })
}
