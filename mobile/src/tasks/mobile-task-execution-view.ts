import type { MobileLocalTaskFeed } from './mobile-local-task-hook'
import { mobileLocalTaskSourceLabel, type MobileLocalTaskRow } from './mobile-local-task-model'
import type { TaskProvider } from './mobile-task-providers'

export type MobileTaskExecutionScope = 'all' | 'local'
export type MobileTaskExecutionGroupFilter = 'all' | 'in-progress' | 'recent-completed'

export type MobileTaskExecutionView = {
  feed: MobileLocalTaskFeed
  filterEmpty: boolean
  normalizedQuery: string
  searchEmpty: boolean
}

export type MobileTaskSearchView = {
  searchPlaceholder: string
  searchValue: string
  showSearchClear: boolean
}

function matchesExecutionQuery(row: MobileLocalTaskRow, normalizedQuery: string): boolean {
  return [
    mobileLocalTaskSourceLabel(row.source),
    row.title,
    row.repo,
    row.branch,
    row.agentDisplayName,
    row.worktreeDisplayName
  ].some((value) => value?.toLowerCase().includes(normalizedQuery) === true)
}

/** Keeps provider backlogs out of Runtime execution state while applying source and text scopes. */
export function projectMobileTaskExecutionView({
  feed,
  groupFilter = 'all',
  query,
  scope
}: {
  feed: MobileLocalTaskFeed
  groupFilter?: MobileTaskExecutionGroupFilter
  query: string
  scope: MobileTaskExecutionScope
}): MobileTaskExecutionView {
  const scopedFeed =
    scope === 'local'
      ? {
          ...feed,
          inProgress: feed.inProgress.filter((row) => row.source === 'local'),
          recentCompleted: feed.recentCompleted.filter((row) => row.source === 'local')
        }
      : feed
  const groupedFeed =
    groupFilter === 'in-progress'
      ? { ...scopedFeed, recentCompleted: [] }
      : groupFilter === 'recent-completed'
        ? { ...scopedFeed, inProgress: [] }
        : scopedFeed
  const normalizedQuery = query.trim().toLowerCase()
  const feedForView = normalizedQuery
    ? {
        ...groupedFeed,
        inProgress: groupedFeed.inProgress.filter((row) =>
          matchesExecutionQuery(row, normalizedQuery)
        ),
        recentCompleted: groupedFeed.recentCompleted.filter((row) =>
          matchesExecutionQuery(row, normalizedQuery)
        )
      }
    : groupedFeed
  const scopedCount = scopedFeed.inProgress.length + scopedFeed.recentCompleted.length
  const groupedCount = groupedFeed.inProgress.length + groupedFeed.recentCompleted.length
  const visibleCount = feedForView.inProgress.length + feedForView.recentCompleted.length

  return {
    feed: feedForView,
    filterEmpty: groupFilter !== 'all' && scopedCount > 0 && groupedCount === 0,
    normalizedQuery,
    searchEmpty: normalizedQuery.length > 0 && groupedCount > 0 && visibleCount === 0
  }
}

/** Resolves search chrome without coupling Runtime execution filtering to hosted backlogs. */
export function projectMobileTaskSearchView(args: {
  appliedGithubProjectSearch: string | undefined
  githubPresetQuery: string
  githubProjectSearch: string
  isAllTaskView: boolean
  isGithubProjectSearch: boolean
  isRuntimeTaskView: boolean
  localQuery: string
  provider: TaskProvider
  providerLabel: string
  query: string
}): MobileTaskSearchView {
  const searchValue = args.isRuntimeTaskView
    ? args.localQuery
    : args.isGithubProjectSearch
      ? args.githubProjectSearch
      : args.query
  const searchPlaceholder = args.isRuntimeTaskView
    ? args.isAllTaskView
      ? '搜索任务'
      : '搜索本地任务'
    : args.isGithubProjectSearch
      ? '搜索项目视图'
      : `搜索 ${args.providerLabel} 任务`
  const showSearchClear = args.isRuntimeTaskView
    ? args.localQuery.length > 0
    : args.isGithubProjectSearch
      ? args.githubProjectSearch.length > 0 ||
        (args.appliedGithubProjectSearch !== undefined &&
          args.appliedGithubProjectSearch.length > 0)
      : args.provider === 'github'
        ? args.query.trim() !== args.githubPresetQuery.trim()
        : args.query.length > 0

  return { searchPlaceholder, searchValue, showSearchClear }
}
