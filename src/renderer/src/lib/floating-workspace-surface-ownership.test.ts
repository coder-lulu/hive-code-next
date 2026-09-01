import { describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  mainWorkbenchOwnsFloatingWorkspace,
  resolveActiveFloatingWorkspaceSurface,
  shouldMountFloatingWorkspacePanel
} from './floating-workspace-surface-ownership'

describe('floating workspace surface ownership', () => {
  it('gives the active main workbench exclusive ownership', () => {
    const mainOwns = mainWorkbenchOwnsFloatingWorkspace('terminal', FLOATING_TERMINAL_WORKTREE_ID)

    expect(mainOwns).toBe(true)
    expect(
      shouldMountFloatingWorkspacePanel({
        enabled: true,
        open: true,
        visibleTabCount: 2,
        mainWorkbenchOwnsWorkspace: mainOwns
      })
    ).toBe(false)
  })

  it('retains the closed overlay only while the main workbench does not own it', () => {
    expect(
      shouldMountFloatingWorkspacePanel({
        enabled: true,
        open: false,
        visibleTabCount: 1,
        mainWorkbenchOwnsWorkspace: false
      })
    ).toBe(true)
  })

  it('treats a host-qualified floating bucket as main-workbench ownership', () => {
    expect(
      mainWorkbenchOwnsFloatingWorkspace(
        'terminal',
        `runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`
      )
    ).toBe(true)
  })

  it('provides a main surface before the local cwd lookup resolves', () => {
    expect(resolveActiveFloatingWorkspaceSurface(FLOATING_TERMINAL_WORKTREE_ID, null)).toEqual({
      id: FLOATING_TERMINAL_WORKTREE_ID,
      path: ''
    })
  })

  it('provides an empty-path surface for a host-qualified floating bucket', () => {
    const bucketKey = `runtime:cloud-a|${FLOATING_TERMINAL_WORKTREE_ID}`

    expect(resolveActiveFloatingWorkspaceSurface(bucketKey, null)).toEqual({
      id: bucketKey,
      path: ''
    })
  })

  it('does not create a floating surface for a normal worktree', () => {
    expect(resolveActiveFloatingWorkspaceSurface('project-worktree', '/tmp')).toBeNull()
  })
})
