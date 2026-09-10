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
