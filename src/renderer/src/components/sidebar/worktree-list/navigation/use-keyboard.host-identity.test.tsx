import {
  OpenWorkspaceInSurfaceContext,
  type OpenWorkspaceInSurface
} from './workspace-activation-context'
// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { HostSectionRow } from '../../host-section-rows'
import type { RenderRow } from '../listing/render-row'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

const activateAndRevealWorktree = vi.fn()

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activateAndRevealWorktree(...args)
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { keybindings: undefined }) => unknown) =>
    selector({ keybindings: undefined })
}))

const { useWorktreeListKeyboardNavigation } = await import('./use-keyboard')

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const repo = { id: 'repo-1', path: '/repo-1', displayName: 'Repo 1' }

// Local worktrees carry no `hostId` — `withRepoHostOwnership` leaves them unqualified.
function localRow(id: string): HostSectionRow & { type: 'item' } {
  return {
    type: 'item',
    rowKey: `row:${id}`,
    sectionKey: 'repo:repo-1',
    worktree: { id, repoId: repo.id } as unknown as Worktree,
    repo: repo as never,
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

const rows: HostSectionRow[] = [localRow('a'), localRow('b'), localRow('c')]
const renderRows = rows as unknown as RenderRow[]

let container: HTMLDivElement
let root: Root
let containerKeyDown: ReturnType<typeof useWorktreeListKeyboardNavigation>['handleContainerKeyDown']

function press(direction: 'up' | 'down'): void {
  const mod = getShortcutPlatform() === 'darwin' ? { metaKey: true } : { ctrlKey: true }
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: direction === 'down' ? 'ArrowDown' : 'ArrowUp',
        code: direction === 'down' ? 'ArrowDown' : 'ArrowUp',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...mod
      })
    )
  })
}

function renderProbe(
  activeWorktreeId: string,
  activeHostId: 'local' | null,
  onOpenWorkspace?: OpenWorkspaceInSurface
): void {
  function Probe(): null {
    const navigation = useWorktreeListKeyboardNavigation({
      rows,
      renderRows,
      activeWorktreeId,
      activeWorkspaceExecutionHostId: activeHostId,
      pinnedDisplayPolicy: 'single-location',
      virtualizer: { scrollToIndex: () => {} } as never,
      scrollRef: { current: null },
      activeModal: 'none',
      markDirectScrollInput: () => {}
    })
    containerKeyDown = navigation.handleContainerKeyDown
    return null
  }
  act(() =>
    root.render(
      <OpenWorkspaceInSurfaceContext.Provider value={onOpenWorkspace}>
        <Probe />
      </OpenWorkspaceInSurfaceContext.Provider>
    )
  )
}

beforeEach(() => {
  activateAndRevealWorktree.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('worktree keyboard cycling with a resolved active host', () => {
  it('does not focus a hidden old terminal when Enter is pressed in project navigation', () => {
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    const focus = vi.spyOn(textarea, 'focus')
    renderProbe('b', 'local', vi.fn())
    act(() => containerKeyDown({ key: 'Enter', preventDefault: vi.fn() } as never))
    expect(focus).not.toHaveBeenCalled()
    textarea.remove()
  })

  it('routes keyboard selection to project sessions without activating terminals', () => {
    const openWorkspace = vi.fn()
    renderProbe('b', 'local', openWorkspace)
    press('down')
    expect(openWorkspace).toHaveBeenCalledWith('c', 'local')
    expect(activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('steps to the next row when the active host resolved to local but rows are unqualified', () => {
    // Why: a sidebar click activates with the repo-resolved host (`local`), while
    // local rows carry no hostId; a raw identity compare misses and wraps to the top.
    renderProbe('b', 'local')

    press('down')

    expect(activateAndRevealWorktree).toHaveBeenCalledWith('c', { navigationIntent: 'user-open' })
  })

  it('steps to the previous row when the active host resolved to local', () => {
    renderProbe('b', 'local')

    press('up')

    expect(activateAndRevealWorktree).toHaveBeenCalledWith('a', { navigationIntent: 'user-open' })
  })

  it('still steps normally when the active host is unqualified', () => {
    renderProbe('b', null)

    press('down')

    expect(activateAndRevealWorktree).toHaveBeenCalledWith('c', { navigationIntent: 'user-open' })
  })
})
