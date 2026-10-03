// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      repos: [{ id: 'one' }, { id: 'two' }],
      visibleWorkspaceHostIds: null,
      sortBy: 'manual',
      groupBy: 'status',
      projectOrderBy: 'manual'
    })
}))
vi.mock('./use-sidebar-host-scope-options', () => ({
  useSidebarHostScopeOptions: () => ({ hostOptions: [] })
}))
vi.mock('./sidebar-host-options', () => ({
  getSidebarHostVisibilityLabel: () => 'All hosts',
  shouldShowHostScopeControls: () => true
}))
vi.mock('./SidebarHostScopeMenuSection', () => ({
  SidebarHostScopeMenuSection: () => <div>Host filters</div>
}))
vi.mock('./SidebarRepositoryFilterSection', () => ({
  default: () => <div>Repository filters</div>
}))
vi.mock('./SidebarWorkspaceFilterSection', () => ({
  default: () => <div>Sleeping and hidden filters</div>
}))
vi.mock('./WorktreeCardDisplayMenuSection', () => ({
  WorktreeCardDisplayMenuSection: () => <div>Card display</div>
}))
vi.mock('./SidebarGroupByToggle', () => ({
  SidebarGroupByToggle: () => <div>Grouping mode toggle</div>
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: () => null
}))
vi.mock('@/components/ui/dropdown-menu', () => {
  const Element = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
  return {
    DropdownMenuLabel: Element,
    DropdownMenuRadioGroup: Element,
    DropdownMenuRadioItem: Element,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuSub: Element,
    DropdownMenuSubContent: Element,
    DropdownMenuSubTrigger: Element
  }
})
import { WorkspaceOptionsMenuItems } from './workspace-options-menu-items'
afterEach(cleanup)
it('keeps host, repository, sleeping and hidden filters in fixed project hierarchy while hiding grouping mode', () => {
  render(<WorkspaceOptionsMenuItems fixedProjectHierarchy />)
  expect(screen.queryByText('Grouping mode toggle')).toBeNull()
  expect(screen.queryByText('Group by')).toBeNull()
  expect(screen.getByText('Host filters')).not.toBeNull()
  expect(screen.getByText('Repository filters')).not.toBeNull()
  expect(screen.getByText('Sleeping and hidden filters')).not.toBeNull()
  expect(screen.getByText('Project order')).not.toBeNull()
})
it('retains the grouping mode control for original workspace surfaces', () => {
  render(<WorkspaceOptionsMenuItems />)
  expect(screen.getByText('Grouping mode toggle')).not.toBeNull()
  expect(screen.queryByText('Project order')).toBeNull()
})
