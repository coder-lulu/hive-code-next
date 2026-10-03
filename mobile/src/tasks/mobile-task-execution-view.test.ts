import { describe, expect, it, vi } from 'vitest'
import type { MobileLocalTaskFeed } from './mobile-local-task-hook'
import type { MobileLocalTaskRow, MobileLocalTaskSource } from './mobile-local-task-model'
import {
  projectMobileTaskExecutionView,
  projectMobileTaskSearchView
} from './mobile-task-execution-view'

function task(
  source: MobileLocalTaskSource,
  overrides: Partial<MobileLocalTaskRow> = {}
): MobileLocalTaskRow {
  return {
    id: `${source}:pane-1`,
    worktreeId: `${source}-worktree`,
    tabId: `${source}-tab`,
    paneKey: 'pane-1',
    title: '修复移动任务中心',
    state: 'working',
    statusAt: 1,
    updatedAt: 1,
    completionAt: null,
    agentType: 'codex',
    agentDisplayName: 'Codex',
    repo: 'hive-code-next',
    branch: 'feature/mobile-tasks',
    worktreeDisplayName: 'Mobile Tasks',
    source,
    verifiable: true,
    ...overrides
  }
}

function feed(overrides: Partial<MobileLocalTaskFeed> = {}): MobileLocalTaskFeed {
  const refresh = vi.fn()
  return {
    phase: 'ready',
    inProgress: [task('local'), task('github')],
    recentCompleted: [task('gitlab', { state: 'done', completionAt: 2 })],
    isVerifiable: true,
    refreshing: false,
    error: null,
    metadataError: null,
    refresh,
    reload: refresh,
    ...overrides
  }
}

describe('projectMobileTaskExecutionView', () => {
  it('keeps the Runtime census intact for All, including linked provider origins', () => {
    const sourceFeed = feed()
    const view = projectMobileTaskExecutionView({ feed: sourceFeed, query: '', scope: 'all' })

    expect(view.feed).toBe(sourceFeed)
    expect(view.feed.inProgress.map((row) => row.source)).toEqual(['local', 'github'])
    expect(view.feed.recentCompleted.map((row) => row.source)).toEqual(['gitlab'])
  })

  it('limits Local to genuine local-source rows in both execution groups', () => {
    const view = projectMobileTaskExecutionView({ feed: feed(), query: '', scope: 'local' })

    expect(view.feed.inProgress.map((row) => row.source)).toEqual(['local'])
    expect(view.feed.recentCompleted).toEqual([])
  })

  it('filters real execution groups and distinguishes an empty filter result', () => {
    const inProgress = projectMobileTaskExecutionView({
      feed: feed(),
      groupFilter: 'in-progress',
      query: '',
      scope: 'all'
    })
    const completedLocal = projectMobileTaskExecutionView({
      feed: feed(),
      groupFilter: 'recent-completed',
      query: '',
      scope: 'local'
    })

    expect(inProgress.feed.inProgress).toHaveLength(2)
    expect(inProgress.feed.recentCompleted).toEqual([])
    expect(inProgress.filterEmpty).toBe(false)
    expect(completedLocal.feed.inProgress).toEqual([])
    expect(completedLocal.feed.recentCompleted).toEqual([])
    expect(completedLocal.filterEmpty).toBe(true)
  })

  it.each([
    ['来源', 'github', { source: 'github' as const }],
    ['标题', '权限错误', { title: '修复权限错误' }],
    ['仓库', 'orca', { repo: 'orca-mobile' }],
    ['分支', 'search-feed', { branch: 'feature/search-feed' }],
    ['Agent', 'claude', { agentDisplayName: 'Claude Code' }],
    ['工作区', '支付终端', { worktreeDisplayName: '支付终端' }]
  ])('matches %s case-insensitively without changing feed metadata', (_field, query, overrides) => {
    const sourceFeed = feed({ inProgress: [task(overrides.source ?? 'local', overrides)] })
    const view = projectMobileTaskExecutionView({ feed: sourceFeed, query, scope: 'all' })

    expect(view.feed.inProgress).toHaveLength(1)
    expect(view.feed.phase).toBe('ready')
    expect(view.feed.refresh).toBe(sourceFeed.refresh)
  })

  it('distinguishes a filtered empty result from an already empty scope', () => {
    expect(
      projectMobileTaskExecutionView({ feed: feed(), query: '不存在', scope: 'all' }).searchEmpty
    ).toBe(true)
    expect(
      projectMobileTaskExecutionView({
        feed: feed({ inProgress: [], recentCompleted: [] }),
        query: '不存在',
        scope: 'all'
      }).searchEmpty
    ).toBe(false)
  })
})

describe('projectMobileTaskSearchView', () => {
  const base = {
    appliedGithubProjectSearch: undefined,
    githubPresetQuery: 'is:open',
    githubProjectSearch: '',
    isAllTaskView: false,
    isGithubProjectSearch: false,
    isRuntimeTaskView: false,
    localQuery: '',
    provider: 'github' as const,
    providerLabel: 'GitHub',
    query: 'is:open'
  }

  it('uses Runtime copy and query for All and Local', () => {
    expect(
      projectMobileTaskSearchView({ ...base, isAllTaskView: true, isRuntimeTaskView: true })
    ).toEqual({ searchPlaceholder: '搜索任务', searchValue: '', showSearchClear: false })
    expect(
      projectMobileTaskSearchView({
        ...base,
        isRuntimeTaskView: true,
        localQuery: 'Codex'
      })
    ).toEqual({ searchPlaceholder: '搜索本地任务', searchValue: 'Codex', showSearchClear: true })
  })

  it('preserves hosted provider and GitHub project search behavior', () => {
    expect(projectMobileTaskSearchView(base)).toEqual({
      searchPlaceholder: '搜索 GitHub 任务',
      searchValue: 'is:open',
      showSearchClear: false
    })
    expect(
      projectMobileTaskSearchView({
        ...base,
        appliedGithubProjectSearch: 'active',
        githubProjectSearch: '',
        isGithubProjectSearch: true
      })
    ).toEqual({ searchPlaceholder: '搜索项目视图', searchValue: '', showSearchClear: true })
  })
})
