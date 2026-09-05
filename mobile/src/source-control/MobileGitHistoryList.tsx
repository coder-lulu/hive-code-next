import { memo, useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import type { MobileTheme } from '../theme/mobile-theme'
import { useMobileTheme, useMobileThemeStyles } from '../theme/mobile-theme-provider'
import type { ConnectionState, RpcSuccess } from '../transport/types'
import type { RpcClient } from '../transport/rpc-client'
import { useForceReconnect } from '../transport/client-context'
import {
  fetchMobileGitHistory,
  mapMobileCommitRows,
  type MobileCommitRow
} from './mobile-git-history'
import { resolveMobileHistoryScreenView } from './mobile-history-screen-state'
import type { GitBranchChangeEntry } from '../../../src/shared/git-diff-compare-types'

type Props = {
  client: RpcClient | null
  connState: ConnectionState
  worktreeId: string
  // Needed so Retry can revive a parked reconnect loop (STA-1511 / #5049).
  hostId: string
  bottomInset: number
  // Bumped by the hub header refresh so History reloads without remounting.
  refreshNonce?: number
}

// Headerless commit-history list. Extracted from the /history route so the hub's
// History segment and the standalone route render the same body over one code path.
// Memoized: it stays mounted (hidden) while the Changes segment is active, and must
// not re-reconcile its FlatList on every commit-message keystroke re-render.
export const MobileGitHistoryList = memo(function MobileGitHistoryList({
  client,
  connState,
  worktreeId,
  hostId,
  bottomInset,
  refreshNonce = 0
}: Props) {
  const theme = useMobileTheme()
  const styles = useMobileThemeStyles(createStyles)
  const forceReconnect = useForceReconnect()
  const [rows, setRows] = useState<MobileCommitRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filesById, setFilesById] = useState<Record<string, GitBranchChangeEntry[] | 'loading'>>({})

  // Host or worktree identity change must wipe history immediately — even while
  // disconnected — so a kept-mounted hub segment never shows another tree's commits.
  useEffect(() => {
    setRows(null)
    setError(null)
    setExpanded(null)
    setFilesById({})
  }, [hostId, worktreeId])

  useEffect(() => {
    let active = true
    if (!client || connState !== 'connected' || !worktreeId) {
      // Why: leave already-loaded rows (and expand state) alone across a drop —
      // resolveMobileHistoryScreenView keeps them visible (STA-1511).
      return
    }
    // Why (F10): clear only the error (it wins render precedence, so a stale one would outlive a
    // successful retry) — the loaded rows stay up until fresh ones land instead of flashing empty.
    setError(null)
    void (async () => {
      try {
        const result = await fetchMobileGitHistory(client, worktreeId)
        if (active) {
          setRows(mapMobileCommitRows(result, Date.now()))
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : '无法加载提交历史')
        }
      }
    })()
    return () => {
      active = false
    }
  }, [client, connState, reloadNonce, refreshNonce, worktreeId])

  const retry = useCallback(() => {
    setError(null)
    // Why: retrying the fetch is useless while the transport's reconnect loop
    // is parked at its backoff cap — revive the connection instead (mirrors
    // MobileSourceControlPanel / issue #5049). The load effect re-runs via
    // connState once the fresh client connects.
    if (connState !== 'connected' && hostId) {
      void forceReconnect(hostId)
      return
    }
    setReloadNonce((n) => n + 1)
  }, [connState, forceReconnect, hostId])

  const toggleCommit = useCallback((row: MobileCommitRow) => {
    setExpanded((current) => (current === row.id ? null : row.id))
  }, [])

  // Why (F10): the expanded commit's files load here, not in the tap handler, so a row expanded
  // during an outage refetches on reconnect instead of caching the outage's answer forever.
  useEffect(() => {
    if (!expanded || !client || connState !== 'connected') {
      return
    }
    const commitId = expanded
    let stale = false
    setFilesById((prev) => (prev[commitId] ? prev : { ...prev, [commitId]: 'loading' }))
    void client
      .sendRequest('git.commitCompare', { worktree: `id:${worktreeId}`, commitId })
      .then((response) => {
        const entries = response.ok
          ? ((response as RpcSuccess).result as { entries: GitBranchChangeEntry[] }).entries
          : []
        if (!stale) {
          setFilesById((prev) => ({ ...prev, [commitId]: entries }))
        }
      })
      .catch(() => {
        // Keep an already-loaded list; a first load that fails resolves to "No file changes".
        if (!stale) {
          setFilesById((prev) =>
            prev[commitId] === 'loading' ? { ...prev, [commitId]: [] } : prev
          )
        }
      })
    return () => {
      stale = true
    }
  }, [client, connState, expanded, worktreeId])

  const connected = client !== null && connState === 'connected'

  const renderCommit = useCallback(
    ({ item }: { item: MobileCommitRow }) => {
      const files = filesById[item.id]
      const isOpen = expanded === item.id
      return (
        <View style={styles.commit}>
          <Pressable
            style={({ pressed }) => [styles.commitHeader, pressed && styles.commitHeaderPressed]}
            onPress={() => toggleCommit(item)}
          >
            {isOpen ? (
              <ChevronDown size={16} color={theme.color.text.tertiary} strokeWidth={2} />
            ) : (
              <ChevronRight size={16} color={theme.color.text.tertiary} strokeWidth={2} />
            )}
            <View style={styles.commitMain}>
              <Text style={styles.commitSubject} numberOfLines={1}>
                {item.subject}
              </Text>
              <Text style={styles.commitMeta} numberOfLines={1}>
                {item.shortId} · {item.author} · {item.relativeTime}
              </Text>
            </View>
          </Pressable>
          {isOpen ? (
            <View style={styles.files}>
              {files === 'loading' || files === undefined ? (
                // No request can complete while disconnected, so say so instead of spinning forever.
                connected ? (
                  <ActivityIndicator size="small" color={theme.color.text.secondary} />
                ) : (
                  <Text style={styles.empty}>正在等待电脑连接...</Text>
                )
              ) : files.length === 0 ? (
                <Text style={styles.empty}>没有文件更改</Text>
              ) : (
                files.map((file) => (
                  <View key={file.path} style={styles.fileRow}>
                    <Text style={styles.filePath} numberOfLines={1}>
                      {file.path}
                    </Text>
                    <Text style={styles.fileStat}>
                      {file.added ? <Text style={styles.add}>+{file.added} </Text> : null}
                      {file.removed ? <Text style={styles.del}>-{file.removed}</Text> : null}
                    </Text>
                  </View>
                ))
              )}
            </View>
          ) : null}
        </View>
      )
    },
    [connected, expanded, filesById, styles, theme, toggleCommit]
  )

  const view = resolveMobileHistoryScreenView({ connected, rows, error })

  if (view.kind === 'error' || view.kind === 'waiting') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>
          {view.kind === 'waiting' ? '正在等待电脑连接...' : view.message}
        </Text>
        <Pressable style={styles.retryButton} onPress={retry} accessibilityLabel="重试">
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      </View>
    )
  }
  if (view.kind === 'loading') {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={theme.color.text.secondary} />
      </View>
    )
  }
  if (view.kind === 'empty') {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>没有提交记录。</Text>
      </View>
    )
  }
  return (
    <FlatList
      data={view.rows}
      renderItem={renderCommit}
      keyExtractor={(row) => row.id}
      contentContainerStyle={{ paddingBottom: theme.spacing.space16 + bottomInset }}
    />
  )
})

function createStyles(theme: MobileTheme) {
  return StyleSheet.create({
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.space16
    },
    stateText: { ...theme.typography.body, color: theme.color.text.tertiary },
    retryButton: {
      minHeight: theme.size.minimumTouchTarget,
      marginTop: theme.spacing.space12,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border.default,
      backgroundColor: theme.color.bg.surface,
      alignItems: 'center',
      justifyContent: 'center'
    },
    retryText: { ...theme.typography.label, color: theme.color.text.primary, fontWeight: '600' },
    commit: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle
    },
    commitHeader: {
      minHeight: theme.size.groupedListRowMinHeight,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.space8,
      paddingHorizontal: theme.spacing.space16,
      paddingVertical: theme.spacing.space8
    },
    commitHeaderPressed: { backgroundColor: theme.color.bg.subtle },
    commitMain: { flex: 1, minWidth: 0 },
    commitSubject: { ...theme.typography.body, color: theme.color.text.primary },
    commitMeta: {
      ...theme.typography.code,
      color: theme.color.text.tertiary,
      marginTop: theme.spacing.space4
    },
    files: {
      paddingHorizontal: theme.spacing.space20,
      paddingBottom: theme.spacing.space8,
      gap: theme.spacing.space4
    },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.space8 },
    filePath: {
      flex: 1,
      ...theme.typography.code,
      color: theme.color.text.secondary
    },
    fileStat: { ...theme.typography.code },
    add: { color: theme.color.status.successText },
    del: { color: theme.color.status.dangerText },
    empty: { ...theme.typography.caption, color: theme.color.text.tertiary }
  })
}
