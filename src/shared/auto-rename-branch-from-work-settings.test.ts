import { describe, expect, it } from 'vitest'
import { normalizeAutoRenameBranchFromWorkDefaultOn } from './auto-rename-branch-from-work-settings'

it.each([undefined, {}, { autoRenameBranchFromWork: true }])(
  'defaults absent branch rename settings on: %o',
  (settings) => {
    expect(normalizeAutoRenameBranchFromWorkDefaultOn(settings)).toEqual({
      autoRenameBranchFromWork: true
    })
  }
)
describe('explicit branch rename choice', () => {
  it('preserves false without a migration marker, including repeated normalization', () => {
    const normalized = normalizeAutoRenameBranchFromWorkDefaultOn({
      autoRenameBranchFromWork: false
    })
    expect(normalized).toEqual({ autoRenameBranchFromWork: false })
    expect(normalizeAutoRenameBranchFromWorkDefaultOn(normalized)).toEqual(normalized)
  })
})
