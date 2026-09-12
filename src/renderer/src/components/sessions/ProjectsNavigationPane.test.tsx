// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  props: null as null | {
    selectedWorkspace: unknown
    projectHierarchy: boolean
    onOpenWorkspace: (id: string, host: 'ssh:server') => void
  }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { openModal: typeof mocks.openModal }) => unknown) =>
    selector({ openModal: mocks.openModal })
}))
vi.mock('../sidebar/WorktreeList', () => ({
  default: (props: NonNullable<typeof mocks.props>) => {
    mocks.props = props
    return (
      <button onClick={() => props.onOpenWorkspace('main', 'ssh:server')}>Select workspace</button>
    )
  }
}))
vi.mock('../sidebar/SidebarWorkspaceOptionsMenu', () => ({
  default: () => <button>Workspace options</button>
}))
vi.mock('./SessionCreationMenu', () => ({ default: () => null }))
import ProjectsNavigationPane from './ProjectsNavigationPane'
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})
it('selects the scoped host and canonical workspace without opening a terminal on mount', () => {
  const open = vi.fn()
  render(
    <ProjectsNavigationPane
      scope={{ kind: 'workspace', workspaceKey: 'worktree:main', executionHostId: 'ssh:server' }}
      onOpenWorkspace={open}
    />
  )
  expect(mocks.props?.selectedWorkspace).toEqual({
    worktreeId: 'main',
    executionHostId: 'ssh:server'
  })
  expect(mocks.props?.projectHierarchy).toBe(true)
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Select workspace' }))
  expect(open).toHaveBeenCalledWith('main', 'ssh:server')
})
it('does not select the old terminal owner when entering projects without a workspace scope', () => {
  render(<ProjectsNavigationPane scope={{ kind: 'all' }} onOpenWorkspace={vi.fn()} />)
  expect(mocks.props?.selectedWorkspace).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add project' }))
  expect(mocks.openModal).toHaveBeenCalledWith('add-repo')
})
it('preserves folder workspace keys instead of treating them as raw git ids', () => {
  render(
    <ProjectsNavigationPane
      scope={{ kind: 'workspace', workspaceKey: 'folder:notes', executionHostId: 'local' }}
      onOpenWorkspace={vi.fn()}
    />
  )
  expect(mocks.props?.selectedWorkspace).toEqual({
    worktreeId: 'folder:notes',
    executionHostId: 'local'
  })
})

it('does not rerender the tree for unrelated parent updates', () => {
  const scope = { kind: 'all' } as const
  const open = vi.fn()
  const view = render(<ProjectsNavigationPane scope={scope} onOpenWorkspace={open} />)
  const props = mocks.props
  view.rerender(<ProjectsNavigationPane scope={scope} onOpenWorkspace={open} />)
  expect(mocks.props).toBe(props)
})

it('uses original worktree activation and active-owner selection in the workbench', () => {
  render(<ProjectsNavigationPane scope={{ kind: 'all' }} useActiveWorkspace />)
  expect(mocks.props?.onOpenWorkspace).toBeUndefined()
  expect(mocks.props?.selectedWorkspace).toBeUndefined()
})

it('resizes with the keyboard, clamps bounds and remembers the chosen width', () => {
  const view = render(<ProjectsNavigationPane scope={{ kind: 'all' }} useActiveWorkspace />)
  const handle = screen.getByRole('separator', { name: 'Resize projects pane' })
  const pane = screen.getByTestId('projects-navigation-pane')
  expect(pane.style.width).toBe('320px')
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(pane.style.width).toBe('336px')
  fireEvent.keyDown(handle, { key: 'End' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(pane.style.width).toBe('520px')
  view.unmount()
  render(<ProjectsNavigationPane scope={{ kind: 'all' }} useActiveWorkspace />)
  expect(screen.getByTestId('projects-navigation-pane').style.width).toBe('520px')
  fireEvent.doubleClick(screen.getByRole('separator'))
  expect(screen.getByTestId('projects-navigation-pane').style.width).toBe('320px')
})

it('remembers project collapse separately and keeps the workspace tree mounted', () => {
  localStorage.setItem('hive-sessions-pane-collapsed', 'true')
  const open = vi.fn()
  const scope = { kind: 'all' } as const
  const view = render(<ProjectsNavigationPane scope={scope} onOpenWorkspace={open} />)
  const tree = screen.getByRole('button', { name: 'Select workspace' })
  fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowRight' })
  const collapse = screen.getByRole('button', { name: 'Collapse projects pane' })
  collapse.focus()
  fireEvent.click(collapse)
  expect(tree.isConnected).toBe(true)
  expect(screen.queryByRole('button', { name: 'Select workspace' })).toBeNull()
  expect(screen.queryByRole('separator')).toBeNull()
  const expand = screen.getByRole('button', { name: 'Expand projects pane' })
  expect(document.activeElement).toBe(expand)
  expect(expand.getAttribute('aria-expanded')).toBe('false')
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(expand)
  expect(screen.getByTestId('projects-navigation-pane').style.width).toBe('336px')
  expect(screen.getByRole('button', { name: 'Select workspace' })).toBe(tree)
  expect(localStorage.getItem('hive-sessions-pane-collapsed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Collapse projects pane' }))
  view.unmount()
  render(<ProjectsNavigationPane scope={scope} onOpenWorkspace={open} />)
  expect(screen.getByRole('button', { name: 'Expand projects pane' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Expand projects pane' }))
  expect(screen.getByTestId('projects-navigation-pane').style.width).toBe('336px')
})
