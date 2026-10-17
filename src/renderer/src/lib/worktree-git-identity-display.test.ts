import { describe, expect, it, vi } from 'vitest'
vi.mock('@/i18n/i18n', () => ({
  translate: (key: string, _fallback: string, values: { head: string }) => `${key}:${values.head}`
}))
import {
  getWorktreeGitIdentityDisplay,
  getDetachedHeadTooltip
} from './worktree-git-identity-display'
describe('translated git identity adapter', () => {
  it('delegates branch normalization without translating branch names', () => {
    expect(getWorktreeGitIdentityDisplay({ branch: ' refs/heads/main ' })).toEqual({
      kind: 'branch',
      branchName: 'refs/heads/main'
    })
    expect(getWorktreeGitIdentityDisplay({ branch: 'refs/heads/main' })).toEqual({
      kind: 'branch',
      branchName: 'main'
    })
    expect(getWorktreeGitIdentityDisplay({})).toBeNull()
  })
  it('translates all detached labels using the shared shortened hash', () => {
    expect(getWorktreeGitIdentityDisplay({ head: 'abcdef012345' })).toEqual({
      kind: 'detached',
      shortHead: 'abcdef0',
      sidebarLabel: 'components.detachedHead.sidebar:abcdef0',
      sourceControlLabel: 'components.detachedHead.sourceControl:abcdef0',
      tooltip: 'components.detachedHead.tooltip:abcdef0'
    })
    expect(getDetachedHeadTooltip('abc')).toBe('components.detachedHead.tooltip:abc')
  })
})
