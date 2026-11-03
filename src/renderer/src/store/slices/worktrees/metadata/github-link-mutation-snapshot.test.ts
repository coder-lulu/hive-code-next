import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureGitHubLinkMutationGuard } from './github-link-mutation-snapshot'
import type { WorktreeSliceGet } from '../listing/worktree-slice-types'

const mocks = vi.hoisted(() => ({ owner: vi.fn(), revision: vi.fn() }))
vi.mock('@/lib/resolve-owner', () => ({ runtimeTargetForWorkspaceOwner: mocks.owner }))
vi.mock('../../../../runtime/runtime-environment-revision', () => ({
  getRuntimeEnvironmentRevision: mocks.revision
}))

const get = (() => ({})) as WorktreeSliceGet
const row = {
  hostId: 'local' as const,
  instanceId: 'generation-1',
  linkedPR: null,
  suppressedGitHubPR: null
}
beforeEach(() => {
  mocks.owner.mockReturnValue({ kind: 'environment', environmentId: 'env' })
  mocks.revision.mockReturnValue(1)
})
describe('GitHub link mutation snapshot', () => {
  it('accepts the same observed automatic link state', () => {
    expect(captureGitHubLinkMutationGuard(get, 'wt', 'local', row)(row)).toBe(true)
  })
  it.each([
    { ...row, linkedPR: 9 },
    { ...row, suppressedGitHubPR: 9 },
    { ...row, instanceId: 'generation-2' },
    { ...row, hostId: 'ssh:other' }
  ])('rejects a changed observation %j', (changed) => {
    expect(captureGitHubLinkMutationGuard(get, 'wt', 'local', row)(changed)).toBe(false)
  })
  it('rejects a changed runtime target', () => {
    const isCurrent = captureGitHubLinkMutationGuard(get, 'wt', 'local', row)
    mocks.owner.mockReturnValue({ kind: 'environment', environmentId: 'other' })
    expect(isCurrent(row)).toBe(false)
  })
  it('rejects a new pairing with the same runtime identifier', () => {
    const isCurrent = captureGitHubLinkMutationGuard(get, 'wt', 'local', row)
    mocks.revision.mockReturnValue(2)
    expect(isCurrent(row)).toBe(false)
  })
  it('refuses missing ownership or an absent base', () => {
    expect(captureGitHubLinkMutationGuard(get, 'wt', 'local', null)(row)).toBe(false)
    mocks.owner.mockReturnValue(null)
    expect(captureGitHubLinkMutationGuard(get, 'wt', 'local', row)(row)).toBe(false)
  })
})
