// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n/i18n'
import { checksLabel, getConflictOperationLabel } from './WorktreeCardHelpers'
import { ReviewChecksBadge } from './WorktreeCardMetadataStatusBadges'
import { WorktreeCardStatusSlot } from './WorktreeCardStatusSlot'
import { useWorktreeCardWorkspaceActions } from './use-worktree-card-workspace-actions'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <span data-tooltip-content="">{children}</span>
  )
}))
vi.mock('./use-worktree-activity-status', () => ({ useWorktreeActivityStatus: () => 'active' }))
vi.mock('@/store', () => {
  const state = {
    tabsByWorktree: { 'worktree-42': [{ id: 'tab-42' }] },
    ptyIdsByTabId: { 'tab-42': ['pty-42'] }
  }
  return {
    useAppStore: Object.assign((selector: (snapshot: typeof state) => unknown) => selector(state), {
      getState: () => state
    })
  }
})
vi.mock('./delete-worktree-flow', () => ({ runWorktreeDelete: vi.fn() }))
vi.mock('./workspace-status', () => ({ writeWorkspaceDragData: vi.fn() }))

const expectedLocales = [
  {
    locale: 'en',
    checks: ['Passing', 'Failing', 'Pending'],
    prefix: 'Checks: ',
    operations: ['Merging', 'Rebasing', 'Cherry-picking'],
    read: 'Mark as read',
    unread: 'Mark as unread',
    unreadState: 'Unread',
    failed: 'PR checks: Failed',
    merged: 'MR: Merged'
  },
  {
    locale: 'es',
    checks: ['Correcto', 'Con errores', 'Pendiente'],
    prefix: 'Comprobaciones: ',
    operations: ['Fusionando', 'Rebasando', 'Aplicando commits seleccionados'],
    read: 'Marcar como leído',
    unread: 'Marcar como no leído',
    unreadState: 'No leído',
    failed: 'Comprobaciones de PR: Fallidas',
    merged: 'MR: Fusionada'
  },
  {
    locale: 'fr',
    checks: ['Réussies', 'En échec', 'En attente'],
    prefix: 'Vérifications : ',
    operations: ['Fusion en cours', 'Rebasage en cours', 'Sélection de commits en cours'],
    read: 'Marquer comme lu',
    unread: 'Marquer comme non lu',
    unreadState: 'Non lu',
    failed: 'Vérifications de PR : Échec',
    merged: 'MR : Fusionnée'
  },
  {
    locale: 'ja',
    checks: ['成功', '失敗', '保留中'],
    prefix: 'チェック: ',
    operations: ['マージ中', 'リベース中', 'チェリーピック中'],
    read: '既読にする',
    unread: '未読にする',
    unreadState: '未読',
    failed: 'PR のチェック: 失敗',
    merged: 'MR: マージ済み'
  },
  {
    locale: 'ko',
    checks: ['통과', '실패', '대기 중'],
    prefix: '검사: ',
    operations: ['병합 중', '리베이스 중', '체리픽 중'],
    read: '읽음으로 표시',
    unread: '읽지 않음으로 표시',
    unreadState: '읽지 않음',
    failed: 'PR 검사: 실패',
    merged: 'MR: 병합됨'
  },
  {
    locale: 'zh',
    checks: ['通过', '失败', '等待中'],
    prefix: '检查：',
    operations: ['正在合并', '正在变基', '正在拣选'],
    read: '标为已读',
    unread: '标为未读',
    unreadState: '未读',
    failed: 'PR 检查：失败',
    merged: 'MR：已合并'
  }
] as const

const failedReview: WorktreeCardPrDisplay = {
  provider: 'github',
  number: 42,
  title: 'User-authored review title',
  state: 'open',
  status: 'failure'
}
const slotProps = {
  worktreeId: 'worktree-42',
  showStatus: true,
  showUnreadAction: true,
  unreadTooltip: 'External tooltip',
  onToggleUnread: vi.fn(),
  onPointerDown: vi.fn()
}

const actionInput: Parameters<typeof useWorktreeCardWorkspaceActions>[0] = {
  worktree: {
    id: 'worktree-42',
    repoId: 'repo-42',
    displayName: 'User workspace',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    path: '/workspaces/repo',
    head: 'abc123',
    branch: 'refs/heads/main',
    isBare: false,
    isMainWorktree: true
  },
  lineageChildCount: 0,
  lineageCollapsed: false,
  isMultiSelected: false,
  folderWorkspaceId: null,
  deleteFolderWorkspace: vi.fn(async () => false),
  setActiveWorktree: vi.fn(),
  setShowRenameErrorDialog: vi.fn(),
  isDeleting: false,
  showDeleteQuickAction: false
}

function ProducedUnreadStatus({ isUnread }: { isUnread: boolean }): ReactNode {
  const actions = useWorktreeCardWorkspaceActions({
    ...actionInput,
    worktree: { ...actionInput.worktree, isUnread }
  })
  return (
    <div data-produced-tooltip={isUnread ? 'read' : 'unread'}>
      <WorktreeCardStatusSlot
        {...slotProps}
        showStatus={false}
        isUnread={isUnread}
        unreadTooltip={actions.unreadTooltip}
      />
    </div>
  )
}

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('native worktree card status localization', () => {
  it.each(expectedLocales)('renders every check/conflict state in $locale', async (expected) => {
    await i18n.changeLanguage(expected.locale)
    const statuses = ['success', 'failure', 'pending'] as const
    statuses.forEach((status, index) => {
      expect(checksLabel(status)).toBe(expected.checks[index])
      const markup = renderToStaticMarkup(<ReviewChecksBadge status={status} />)
      expect(markup).toContain(`${expected.prefix}${expected.checks[index]}`)
      expect(markup).not.toContain('{{')
    })
    expect(renderToStaticMarkup(<ReviewChecksBadge status="neutral" />)).toBe('')
    expect(renderToStaticMarkup(<ReviewChecksBadge status={undefined} />)).toBe('')
    expect(checksLabel('neutral')).toBe('')
    const operations = ['merge', 'rebase', 'cherry-pick'] as const
    operations.forEach((operation, index) => {
      expect(getConflictOperationLabel(operation)).toBe(expected.operations[index])
    })
    expect(getConflictOperationLabel('unknown')).toBe('')
  })

  it.each(expectedLocales)(
    'keeps merged review priority and provider labels in $locale',
    async (expected) => {
      await i18n.changeLanguage(expected.locale)
      const markup = renderToStaticMarkup(
        <WorktreeCardStatusSlot
          {...slotProps}
          newCardStyle
          isUnread={false}
          prDisplay={{ ...failedReview, provider: 'gitlab', state: 'merged' }}
        />
      )
      expect(markup).toContain(expected.merged)
      expect(markup).not.toContain(expected.failed)
      expect(markup).not.toContain('PR:')
      expect(markup).not.toContain('{{')
    }
  )

  it('updates mounted native check, action and review announcements through all six languages', async () => {
    const { container } = render(
      <>
        <ReviewChecksBadge status="failure" />
        <ProducedUnreadStatus isUnread />
        <ProducedUnreadStatus isUnread={false} />
        <WorktreeCardStatusSlot {...slotProps} newCardStyle isUnread prDisplay={failedReview} />
      </>
    )
    const buttons = container.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    const reviewAnnouncement = container.querySelector('.sr-only')
    for (const expected of expectedLocales) {
      await act(async () => {
        await i18n.changeLanguage(expected.locale)
      })
      expect(container.textContent).toContain(`${expected.prefix}${expected.checks[1]}`)
      expect(buttons[0].getAttribute('aria-label')).toBe(expected.read)
      expect(buttons[1].getAttribute('aria-label')).toBe(expected.unread)
      const readTooltip = container.querySelector(
        '[data-produced-tooltip="read"] [data-tooltip-content]'
      )
      const unreadTooltip = container.querySelector(
        '[data-produced-tooltip="unread"] [data-tooltip-content]'
      )
      expect(readTooltip?.textContent).toBe(expected.locale === 'en' ? 'Mark read' : expected.read)
      expect(unreadTooltip?.textContent).toBe(
        expected.locale === 'en' ? 'Mark unread' : expected.unread
      )
      expect(reviewAnnouncement?.textContent).toBe(`${expected.failed} · ${expected.unreadState}`)
      expect(container.textContent).not.toContain('{{')
      expect(container.querySelectorAll('button')[0]).toBe(buttons[0])
    }
  })
})
