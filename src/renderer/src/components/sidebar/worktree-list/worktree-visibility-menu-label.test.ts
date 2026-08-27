import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../../../shared/repo-types'
import { APP_DISPLAY_NAME } from '@/product-brand'
import { getWorktreeVisibilityMenuLabel } from './worktree-visibility-menu-label'

function repoWithVisibility(visibility: 'show' | 'hide'): Repo {
  return {
    externalWorktreeVisibility: visibility,
    externalWorktreeVisibilityLegacy: false
  } as Repo
}

describe('getWorktreeVisibilityMenuLabel', () => {
  it('keeps the external-worktree action branded after the sidebar extraction', () => {
    expect(getWorktreeVisibilityMenuLabel(repoWithVisibility('show'))).toBe(
      `Hide non-${APP_DISPLAY_NAME} worktrees`
    )
    expect(getWorktreeVisibilityMenuLabel(repoWithVisibility('hide'))).toBe('Show hidden worktrees')
  })
})
