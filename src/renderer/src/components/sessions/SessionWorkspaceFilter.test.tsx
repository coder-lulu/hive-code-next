// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const catalog = vi.hoisted(() => ({
  entities: {
    projectsByIdentity: new Map([
      [
        'local|project:one',
        {
          workspaces: [
            {
              identityKey: 'local|empty',
              name: 'Empty worktree',
              branch: 'feature',
              repoName: 'Repo',
              path: '/repo/empty',
              sessionCount: 0
            }
          ]
        }
      ],
      [
        'ssh:alpha|project:one',
        {
          workspaces: [
            {
              identityKey: 'ssh:alpha|empty',
              name: 'Remote worktree',
              branch: 'feature',
              repoName: 'Repo',
              path: '/repo/empty',
              sessionCount: 0
            }
          ]
        }
      ]
    ])
  }
}))
vi.mock('@/store', () => ({ useAppStore: () => catalog }))
vi.mock('./session-catalog', () => ({ selectSessionCatalog: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
import SessionWorkspaceFilter from './SessionWorkspaceFilter'

afterEach(cleanup)

it('offers empty worktrees from the current project and preserves project scope on selection', () => {
  const onChange = vi.fn()
  render(
    <SessionWorkspaceFilter
      scope={{ kind: 'project', projectKey: 'local|project:one' }}
      onChange={onChange}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Filter by workspace' }))
  expect(screen.queryByText('Remote worktree')).toBeNull()
  fireEvent.click(screen.getByText('Empty worktree'))
  expect(onChange).toHaveBeenCalledWith({
    kind: 'project',
    projectKey: 'local|project:one',
    workspaceKey: 'local|empty'
  })
})

it('can clear an unavailable workspace without showing an incorrect all-workspaces label', () => {
  const onChange = vi.fn()
  render(
    <SessionWorkspaceFilter
      scope={{ kind: 'project', projectKey: 'local|project:one', workspaceKey: 'local|removed' }}
      onChange={onChange}
    />
  )
  expect(screen.getByText('Workspace unavailable')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Filter by workspace' }))
  fireEvent.click(screen.getByText('All workspaces'))
  expect(onChange).toHaveBeenCalledWith({ kind: 'project', projectKey: 'local|project:one' })
})

it('does not display a project workspace selector in the all-sessions scope', () => {
  render(<SessionWorkspaceFilter scope={{ kind: 'all' }} onChange={vi.fn()} />)
  expect(screen.queryByRole('button')).toBeNull()
})
