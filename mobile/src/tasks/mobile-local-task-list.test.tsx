import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lightTheme } from '../theme/mobile-theme'
import type { MobileLocalTaskFeed } from './mobile-local-task-hook'
import { MobileLocalTaskList } from './mobile-local-task-list'
import type { MobileLocalTaskRow } from './mobile-local-task-model'
import { createMobileLocalTaskStyles } from './mobile-local-task-styles'

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  RefreshControl: 'RefreshControl',
  SectionList: 'SectionList',
  StyleSheet: {
    hairlineWidth: 1,
    create: <T,>(styles: T) => styles
  },
  Text: 'Text',
  View: 'View'
}))

vi.mock('lucide-react-native', () => ({
  CircleAlert: 'CircleAlert',
  CircleCheckBig: 'CircleCheckBig',
  Clock3: 'Clock3',
  ListTodo: 'ListTodo',
  Plus: 'Plus',
  RefreshCw: 'RefreshCw'
}))

vi.mock('../hooks/use-now', () => ({ useNow: () => 65_000 }))

function task(overrides: Partial<MobileLocalTaskRow> = {}): MobileLocalTaskRow {
  return {
    id: 'wt-1:pane-1',
    worktreeId: 'wt-1',
    tabId: 'tab-1',
    paneKey: 'pane-1',
    title: '完成任务中心本地视图',
    state: 'done',
    statusAt: 5_000,
    updatedAt: 5_000,
    completionAt: 5_000,
    agentType: 'codex',
    agentDisplayName: 'Codex',
    repo: 'hive-code-next',
    branch: 'mobile-ui',
    worktreeDisplayName: 'Mobile UI',
    source: 'local',
    verifiable: true,
    ...overrides
  }
}

function feed(overrides: Partial<MobileLocalTaskFeed> = {}): MobileLocalTaskFeed {
  const refresh = vi.fn()
  return {
    phase: 'ready',
    inProgress: [],
    recentCompleted: [task()],
    isVerifiable: true,
    refreshing: false,
    error: null,
    metadataError: null,
    refresh,
    reload: refresh,
    ...overrides
  }
}

describe('MobileLocalTaskList', () => {
  let renderer: ReactTestRenderer | null = null
  let rowRenderer: ReactTestRenderer | null = null

  afterEach(() => {
    act(() => {
      rowRenderer?.unmount()
      renderer?.unmount()
    })
    renderer = null
    rowRenderer = null
  })

  it('renders truthful groups and opens the exact worktree tab without a fake progress value', () => {
    const onOpen = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileLocalTaskList, {
          feed: feed(),
          theme: lightTheme,
          now: 65_000,
          onOpen
        })
      )
    })

    const list = renderer!.root.findByType('SectionList')
    expect(list.props.sections.map((section: { title: string }) => section.title)).toEqual([
      '最近完成'
    ])

    act(() => {
      rowRenderer = create(list.props.renderItem({ item: task() }))
    })
    const row = rowRenderer!.root.findByType('Pressable')
    act(() => row.props.onPress())
    expect(onOpen).toHaveBeenCalledWith('wt-1', 'tab-1')

    const text = rowRenderer!.root.findAllByType('Text')
    expect(text.every((node) => node.props.maxFontSizeMultiplier === 1.3)).toBe(true)
    expect(text.map((node) => node.children.join('')).join(' ')).toContain(
      '本地 · hive-code-next · mobile-ui · Codex · 1 分钟前'
    )
    expect(text.map((node) => node.children.join('')).join(' ')).not.toContain('%')

    const status = text.find((node) => node.children.join('') === '已完成')
    expect(status?.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ color: lightTheme.color.status.successText })
      ])
    )
  })

  it('keeps row and retry controls at least 44dp', () => {
    const styles = createMobileLocalTaskStyles(lightTheme)
    expect(styles.row.minHeight).toBeGreaterThanOrEqual(lightTheme.size.minimumTouchTarget)
    expect(styles.statusIcon.width).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.statusIcon.height).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.retryButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
    expect(styles.runtimeButton.minHeight).toBe(lightTheme.size.minimumTouchTarget)
  })

  it('shows an honest retryable source error instead of an empty-task claim', () => {
    const failed = feed({
      phase: 'error',
      recentCompleted: [],
      isVerifiable: false,
      error: 'session inventory failed'
    })
    act(() => {
      renderer = create(
        createElement(MobileLocalTaskList, {
          feed: failed,
          theme: lightTheme,
          onOpen: vi.fn()
        })
      )
    })

    const labels = renderer!.root
      .findAllByType('Text')
      .map((node) => node.children.join(''))
      .join(' ')
    expect(labels).toContain('无法加载本地任务')
    expect(labels).toContain('session inventory failed')
    expect(labels).not.toContain('还没有本地任务')
    expect(renderer!.root.findByProps({ accessibilityLabel: '重试加载本地任务' })).toBeTruthy()
  })

  it('distinguishes an empty search result from an empty Runtime task list', () => {
    act(() => {
      renderer = create(
        createElement(MobileLocalTaskList, {
          feed: feed({ recentCompleted: [] }),
          theme: lightTheme,
          onOpen: vi.fn(),
          searchEmpty: true
        })
      )
    })

    const labels = renderer!.root
      .findAllByType('Text')
      .map((node) => node.children.join(''))
      .join(' ')
    expect(labels).toContain('没有匹配的本地任务')
    expect(labels).not.toContain('还没有本地任务')
  })

  it('uses scope-aware offline and filter-empty copy', () => {
    act(() => {
      renderer = create(
        createElement(MobileLocalTaskList, {
          feed: feed({
            phase: 'disconnected',
            recentCompleted: [],
            isVerifiable: false
          }),
          theme: lightTheme,
          onOpen: vi.fn(),
          scope: 'all'
        })
      )
    })

    let labels = renderer!.root
      .findAllByType('Text')
      .map((node) => node.children.join(''))
      .join(' ')
    expect(labels).toContain('连接恢复前无法验证任务状态')
    expect(labels).not.toContain('本地任务状态')

    act(() =>
      renderer!.update(
        createElement(MobileLocalTaskList, {
          feed: feed({ recentCompleted: [] }),
          filterEmpty: true,
          theme: lightTheme,
          onOpen: vi.fn(),
          scope: 'all'
        })
      )
    )
    labels = renderer!.root
      .findAllByType('Text')
      .map((node) => node.children.join(''))
      .join(' ')
    expect(labels).toContain('没有符合筛选的任务')
    expect(labels).toContain('切换到全部状态查看其他任务')
    expect(renderer!.root.findAllByProps({ accessibilityLabel: '新建任务' })).toHaveLength(0)
  })

  it('uses the unified task empty state for the all-source scope', () => {
    const onCreate = vi.fn()
    const onSelectRuntime = vi.fn()
    act(() => {
      renderer = create(
        createElement(MobileLocalTaskList, {
          feed: feed({ recentCompleted: [] }),
          theme: lightTheme,
          onOpen: vi.fn(),
          onCreate,
          onSelectRuntime,
          scope: 'all'
        })
      )
    })

    const labels = renderer!.root
      .findAllByType('Text')
      .map((node) => node.children.join(''))
      .join(' ')
    expect(labels).toContain('还没有任务')
    expect(labels).toContain('HiveCode 会在已连接的 Runtime 上执行')
    expect(labels).not.toContain('还没有本地任务')

    act(() => renderer!.root.findByProps({ accessibilityLabel: '新建任务' }).props.onPress())
    act(() => renderer!.root.findByProps({ accessibilityLabel: '连接或切换电脑' }).props.onPress())
    expect(onCreate).toHaveBeenCalledOnce()
    expect(onSelectRuntime).toHaveBeenCalledOnce()
  })
})
