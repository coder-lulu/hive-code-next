import { useMobileTranslation } from '../i18n/use-mobile-translation'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { useMemo } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View } from 'react-native'
import { CircleAlert, CircleCheckBig, Clock3, ListTodo, Plus, RefreshCw } from 'lucide-react-native'
import { useNow } from '../hooks/use-now'
import type { MobileTheme } from '../theme/mobile-theme'
import type { MobileLocalTaskFeed } from './mobile-local-task-hook'
import {
  formatMobileLocalTaskTime,
  mobileLocalTaskSourceLabel,
  mobileLocalTaskStatusLabel,
  type MobileLocalTaskRow
} from './mobile-local-task-model'
import { createMobileLocalTaskStyles } from './mobile-local-task-styles'

const MAX_FONT_SIZE_MULTIPLIER = 1.3

type MobileLocalTaskSection = {
  key: 'in-progress' | 'recent-completed'
  title: string
  data: MobileLocalTaskRow[]
}

export type MobileLocalTaskListProps = {
  feed: MobileLocalTaskFeed
  theme: MobileTheme
  onOpen: (worktreeId: string, tabId?: string) => void
  now?: number
  contentBottomInset?: number
  filterEmpty?: boolean
  searchEmpty?: boolean
  scope?: 'all' | 'local'
  onCreate?: () => void
  onSelectRuntime?: () => void
}

function rowMetadata(row: MobileLocalTaskRow, now: number): string {
  return [
    mobileLocalTaskSourceLabel(row.source),
    row.repo,
    row.branch,
    row.agentDisplayName,
    formatMobileLocalTaskTime(row.statusAt, now)
  ]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}

function MobileLocalTaskStatusIcon({
  row,
  theme
}: {
  row: MobileLocalTaskRow
  theme: MobileTheme
}) {
  if (!row.verifiable) {
    return <CircleAlert size={24} color={theme.color.status.warning} strokeWidth={1.9} />
  }
  if (row.state === 'done') {
    return <CircleCheckBig size={24} color={theme.color.status.success} strokeWidth={1.9} />
  }
  if (row.state === 'blocked') {
    return <CircleAlert size={24} color={theme.color.status.warning} strokeWidth={1.9} />
  }
  if (row.state === 'waiting') {
    return <Clock3 size={24} color={theme.color.status.warning} strokeWidth={1.9} />
  }
  return <RefreshCw size={24} color={theme.color.brand.primary} strokeWidth={1.9} />
}

function MobileLocalTaskRowView({
  row,
  theme,
  now,
  onOpen
}: {
  row: MobileLocalTaskRow
  theme: MobileTheme
  now: number
  onOpen: MobileLocalTaskListProps['onOpen']
}) {
  const t = useMobileTranslation()

  const styles = useMemo(() => createMobileLocalTaskStyles(theme), [theme])
  const statusLabel = mobileLocalTaskStatusLabel(row)
  const statusTextStyle = !row.verifiable
    ? styles.statusUnverifiedText
    : row.state === 'done'
      ? styles.statusDoneText
      : row.state === 'blocked' || row.state === 'waiting'
        ? styles.statusAttentionText
        : styles.statusWorkingText

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${row.title}，${statusLabel}，${rowMetadata(row, now)}`}
      accessibilityHint={t('tasks.local.openSession', 'Open the corresponding workspace session')}
      onPress={() => onOpen(row.worktreeId, row.tabId)}
    >
      <View style={styles.statusIcon} accessibilityElementsHidden>
        <MobileLocalTaskStatusIcon row={row} theme={theme} />
      </View>
      <View style={styles.main}>
        <View style={styles.titleRow}>
          <Text
            style={styles.title}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
          >
            {row.title}
          </Text>
          <Text
            style={[styles.status, statusTextStyle]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
          >
            {statusLabel}
          </Text>
        </View>
        <Text
          style={styles.metadataText}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
        >
          {rowMetadata(row, now)}
        </Text>
      </View>
    </Pressable>
  )
}

function MobileLocalTaskState({
  feed,
  theme,
  filterEmpty,
  searchEmpty,
  scope,
  onCreate,
  onSelectRuntime
}: {
  feed: MobileLocalTaskFeed
  theme: MobileTheme
  filterEmpty: boolean
  searchEmpty: boolean
  scope: 'all' | 'local'
  onCreate?: () => void
  onSelectRuntime?: () => void
}) {
  const t = useMobileTranslation()

  const styles = useMemo(() => createMobileLocalTaskStyles(theme), [theme])
  if (feed.phase === 'loading') {
    return (
      <View style={styles.state} accessibilityLiveRegion="polite">
        <ActivityIndicator size="small" color={theme.color.text.secondary} />
        <Text style={styles.stateTitle} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
          {scope === 'all'
            ? t('tasks.local.loadingAll', 'Loading tasks')
            : t('tasks.local.loading', 'Loading local tasks')}
        </Text>
        <Text style={styles.stateText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
          {t('tasks.local.reading', 'Reading terminal sessions from the current Runtime.')}
        </Text>
      </View>
    )
  }

  const disconnected = feed.phase === 'disconnected'
  const failed = feed.phase === 'error'
  const showAllEmptyActions = scope === 'all' && !searchEmpty && !filterEmpty
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      {showAllEmptyActions && !failed ? (
        <View style={styles.emptyIcon} accessibilityElementsHidden>
          <ListTodo color={theme.color.text.secondary} size={32} strokeWidth={1.7} />
        </View>
      ) : null}
      <Text style={styles.stateTitle} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
        {searchEmpty
          ? scope === 'all'
            ? t('tasks.local.noMatchesAll', 'No matching tasks')
            : t('tasks.local.noMatches', 'No matching local tasks')
          : filterEmpty
            ? scope === 'all'
              ? t('tasks.local.filterEmptyAll', 'No tasks match the filter')
              : t('tasks.local.filterEmpty', 'No local tasks match the filter')
            : disconnected
              ? t('tasks.local.disconnected', 'Runtime disconnected')
              : failed
                ? scope === 'all'
                  ? t('tasks.local.loadFailedAll', 'Could not load tasks')
                  : t('tasks.local.loadFailed', 'Could not load local tasks')
                : scope === 'all'
                  ? t('tasks.local.emptyAll', 'No tasks yet')
                  : t('tasks.local.empty', 'No local tasks yet')}
      </Text>
      <Text style={styles.stateText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
        {searchEmpty
          ? t('tasks.local.searchHint', 'Try a different title, repository, branch, or agent.')
          : filterEmpty
            ? t('tasks.local.filterHint', 'Switch to all statuses to see other tasks.')
            : disconnected
              ? scope === 'all'
                ? t(
                    'tasks.local.unverifiedAll',
                    'Task status cannot be verified until the connection recovers.'
                  )
                : t(
                    'tasks.local.unverified',
                    'Local task status cannot be verified until the connection recovers.'
                  )
              : failed
                ? (feed.error ??
                  t('tasks.local.noSessionData', 'The Runtime returned no usable session data.'))
                : scope === 'all'
                  ? t(
                      'tasks.local.startHintAll',
                      'Start with a clear goal. {{value0}} will run on the connected Runtime.',
                      { value0: APP_DISPLAY_NAME }
                    )
                  : t(
                      'tasks.local.startHint',
                      'The current Runtime has no local terminal sessions with a verified agent status.'
                    )}
      </Text>
      {!searchEmpty && !filterEmpty && !disconnected ? (
        <Text style={styles.limitationText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
          {t(
            'tasks.local.recentHint',
            'Recently completed includes only records still in the session list.'
          )}
        </Text>
      ) : null}
      {failed ? (
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={
            scope === 'all'
              ? t('tasks.local.retryAll', 'Retry loading tasks')
              : t('tasks.local.retry', 'Retry loading local tasks')
          }
          onPress={feed.reload}
        >
          <RefreshCw size={17} color={theme.color.text.inverse} strokeWidth={2} />
          <Text style={styles.retryText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
            {t('common.retry', 'Retry')}
          </Text>
        </Pressable>
      ) : null}
      {showAllEmptyActions && !disconnected && !failed && onCreate ? (
        <Pressable
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('tasks.local.newTask', 'New task')}
          onPress={onCreate}
        >
          <Plus size={18} color={theme.color.text.inverse} strokeWidth={2} />
          <Text style={styles.retryText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
            {t('tasks.local.newTask', 'New task')}
          </Text>
        </Pressable>
      ) : null}
      {showAllEmptyActions && onSelectRuntime ? (
        <Pressable
          style={({ pressed }) => [styles.runtimeButton, pressed && styles.runtimeButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('tasks.local.selectComputer', 'Connect or switch computer')}
          onPress={onSelectRuntime}
        >
          <Text style={styles.runtimeButtonText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
            {t('tasks.local.selectComputer', 'Connect or switch computer')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** A route-agnostic Local task view; navigation stays owned by the host tasks route. */
export function MobileLocalTaskList({
  feed,
  theme,
  onOpen,
  now,
  contentBottomInset = 0,
  filterEmpty = false,
  searchEmpty = false,
  scope = 'local',
  onCreate,
  onSelectRuntime
}: MobileLocalTaskListProps) {
  const t = useMobileTranslation()

  const styles = useMemo(() => createMobileLocalTaskStyles(theme), [theme])
  const liveNow = useNow(30_000, now === undefined)
  const displayedNow = now ?? liveNow
  const sections = useMemo<MobileLocalTaskSection[]>(() => {
    const result: MobileLocalTaskSection[] = []
    if (feed.inProgress.length > 0) {
      result.push({
        key: 'in-progress',
        title: t('worktree.workspaceListSections.inProgress', 'In progress'),
        data: feed.inProgress
      })
    }
    if (feed.recentCompleted.length > 0) {
      result.push({
        key: 'recent-completed',
        title: t('tasks.local.recent', 'Recently completed'),
        data: feed.recentCompleted
      })
    }
    return result
  }, [feed.inProgress, feed.recentCompleted, t])

  if (sections.length === 0) {
    return (
      <MobileLocalTaskState
        feed={feed}
        theme={theme}
        filterEmpty={filterEmpty}
        searchEmpty={searchEmpty}
        scope={scope}
        onCreate={onCreate}
        onSelectRuntime={onSelectRuntime}
      />
    )
  }

  const notices: string[] = []
  if (!feed.isVerifiable) {
    notices.push(
      feed.phase === 'disconnected'
        ? 'Runtime 已断开。以下为最后一次快照，当前状态不可验证。'
        : (feed.error ?? '正在重新验证本地任务状态。')
    )
  }
  if (feed.metadataError) {
    notices.push(`工作区信息未更新：${feed.metadataError}`)
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[
        styles.list,
        { paddingBottom: styles.list.paddingBottom + contentBottomInset }
      ]}
      refreshControl={
        feed.phase === 'disconnected' ? undefined : (
          <RefreshControl
            refreshing={feed.refreshing}
            onRefresh={feed.reload}
            tintColor={theme.color.text.secondary}
          />
        )
      }
      ListHeaderComponent={
        notices.length > 0 ? (
          <View accessibilityLiveRegion="polite">
            {notices.map((notice) => (
              <View key={notice} style={styles.notice}>
                <CircleAlert size={16} color={theme.color.status.warning} strokeWidth={2} />
                <Text style={styles.noticeText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
                  {notice}
                </Text>
              </View>
            ))}
          </View>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text
            style={styles.sectionTitle}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}
          >
            {section.title}
          </Text>
          <Text style={styles.sectionCount} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
            {section.data.length}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <MobileLocalTaskRowView row={item} theme={theme} now={displayedNow} onOpen={onOpen} />
      )}
      ListFooterComponent={
        <View style={styles.footer}>
          <Text style={styles.limitationText} maxFontSizeMultiplier={MAX_FONT_SIZE_MULTIPLIER}>
            {t(
              'tasks.local.recentFooter',
              'Recently completed shows sessions retained by the current Runtime, not persistent task history.'
            )}
          </Text>
        </View>
      }
    />
  )
}
