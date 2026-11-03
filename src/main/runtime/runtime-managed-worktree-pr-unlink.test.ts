import { describe, expect, it, vi } from 'vitest'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { GitHubLinkBase } from '../../shared/worktree/github-link-base'
import { hostWorktreeTarget } from '../../shared/worktree/host-qualified-identity'
import type { Worktree } from '../../shared/worktree/types'
import { WorktreeSet } from '../../shared/rpc-contract/worktree-params'
import { updateRuntimeManagedWorktreeMetadata } from './runtime-managed-worktree-metadata'
import type { RuntimeStore } from './runtime-store-contract'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

const base = {
  hostId: 'ssh:build-box',
  linkedPR: 7,
  suppressedGitHubPR: null,
  instanceId: 'current-instance'
} satisfies GitHubLinkBase

function fixture() {
  let meta: Partial<WorktreeMeta> | undefined = { ...base }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture supplies every workspace property read by this operation.
  const worktree = {
    id: 'repo::/workspace',
    repoId: 'repo',
    hostId: 'ssh:build-box',
    path: '/workspace',
    instanceId: base.instanceId
  } as unknown as ResolvedWorktree
  const getWorktreeMeta = vi.fn(() => ({ linkedPR: 999 }))
  const getWorktreeMetaForHost = vi.fn(() => meta)
  const getAllWorktreeMetaForHost = vi.fn(() => (meta ? { [worktree.id]: meta } : {}))
  const setWorktreeMeta = vi.fn<RuntimeStore['setWorktreeMeta']>((target, updates) => {
    const next: WorktreeMeta = {
      displayName: '',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      ...meta,
      ...updates,
      hostId: target.hostId,
      instanceId: meta?.instanceId ?? 'created-instance'
    }
    meta = next
    return next
  })
  const removeWorktreeLineage = vi.fn()
  const removeWorkspaceLineage = vi.fn()
  const setWorktreeLineage = vi.fn<NonNullable<RuntimeStore['setWorktreeLineage']>>(
    (_target, lineage) => lineage
  )
  const setWorkspaceLineage = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these are the actual metadata/lineage ports read by the operation.
  const store = {
    getRepos: () => [],
    getWorktreeMeta,
    getWorktreeMetaForHost,
    getAllWorktreeMetaForHost,
    setWorktreeMeta,
    removeWorktreeLineage,
    removeWorkspaceLineage,
    setWorktreeLineage,
    setWorkspaceLineage
  } as unknown as RuntimeStore
  const ports = {
    resolveWorktree: vi.fn(async (_selector: string) => worktree),
    validateParent: vi.fn(),
    invalidateResolved: vi.fn(),
    invalidateScan: vi.fn(),
    notifyChanged: vi.fn(),
    showWorktree: vi.fn(async () => ({ ...worktree, ...meta }) as unknown as Worktree)
  }
  const githubLinkBase: GitHubLinkBase = { ...base }
  const updates = { linkedPR: null, suppressedGitHubPR: 7, githubLinkBase }
  const run = () =>
    updateRuntimeManagedWorktreeMetadata({
      selector: `id:${worktree.id}`,
      updates,
      store,
      ports
    })
  return {
    store,
    ports,
    worktree,
    updates,
    run,
    getWorktreeMeta,
    getWorktreeMetaForHost,
    getAllWorktreeMetaForHost,
    setWorktreeMeta,
    removeWorktreeLineage,
    removeWorkspaceLineage,
    setWorktreeLineage,
    setWorkspaceLineage,
    setMeta: (value: Partial<WorktreeMeta> | undefined) => {
      meta = value
    }
  }
}

describe('current GitHub unlink compare-and-set', () => {
  it.each(['recreated', 'removed', 'moved', 'unchanged'] as const)(
    'checks a parent %s during final primary resolution before any writes',
    async (change) => {
      const f = fixture()
      const parent = {
        ...f.worktree,
        id: 'repo::/parent',
        path: '/parent',
        instanceId: 'parent-instance'
      }
      let parentMeta: Partial<WorktreeMeta> | undefined = {
        hostId: base.hostId,
        instanceId: parent.instanceId
      }
      f.getAllWorktreeMetaForHost.mockImplementation(() => ({
        [f.worktree.id]: { ...base },
        ...(parentMeta ? { [parent.id]: parentMeta } : {})
      }))
      let release!: () => void
      let started!: () => void
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      const lookupStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      let primaryLookups = 0
      f.ports.resolveWorktree.mockImplementation(async (selector) => {
        if (selector === 'parent') {
          return parent
        }
        primaryLookups += 1
        if (primaryLookups === 2) {
          started()
          await waiting
        }
        return f.worktree
      })
      const result = updateRuntimeManagedWorktreeMetadata({
        selector: `id:${f.worktree.id}`,
        updates: { ...f.updates, lineage: { parentWorktree: 'parent' } },
        store: f.store,
        ports: f.ports
      })
      const settled =
        change === 'unchanged' ? result : expect(result).rejects.toThrow('github_link_conflict')
      await lookupStarted
      parentMeta =
        change === 'removed'
          ? undefined
          : change === 'recreated'
            ? { hostId: base.hostId, instanceId: 'replacement-parent' }
            : {
                hostId: change === 'moved' ? 'ssh:other' : base.hostId,
                instanceId: parent.instanceId
              }
      release()
      await settled
      if (change === 'unchanged') {
        expect(f.setWorktreeLineage).toHaveBeenCalledWith(
          hostWorktreeTarget({ id: f.worktree.id, hostId: 'ssh:build-box' }),
          expect.objectContaining({
            parentWorktreeId: parent.id,
            parentWorktreeInstanceId: parent.instanceId
          })
        )
        expect(f.setWorkspaceLineage).toHaveBeenCalledTimes(1)
        expect(f.setWorktreeMeta).toHaveBeenCalledTimes(1)
        expect(f.setWorktreeLineage.mock.invocationCallOrder[0]).toBeLessThan(
          f.setWorkspaceLineage.mock.invocationCallOrder[0]
        )
        expect(f.setWorkspaceLineage.mock.invocationCallOrder[0]).toBeLessThan(
          f.setWorktreeMeta.mock.invocationCallOrder[0]
        )
      } else {
        expect(f.setWorktreeLineage).not.toHaveBeenCalled()
        expect(f.setWorkspaceLineage).not.toHaveBeenCalled()
        expect(f.setWorktreeMeta).not.toHaveBeenCalled()
      }
      expect(f.getWorktreeMetaForHost).not.toHaveBeenCalled()
      expect(f.getWorktreeMeta).not.toHaveBeenCalled()
      expect(f.ports.resolveWorktree).toHaveBeenCalledTimes(3)
    }
  )
  it.each([
    { ...base, linkedPR: 8 },
    { ...base, suppressedGitHubPR: 9 },
    { ...base, instanceId: 'replacement-instance' }
  ])('refuses a changed current metadata snapshot before any write: %o', async (changed) => {
    const f = fixture()
    f.setMeta(changed)
    await expect(f.run()).rejects.toThrow('github_link_conflict')
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
    expect(f.ports.notifyChanged).not.toHaveBeenCalled()
  })

  it('does not remove lineage when the same transaction has a stale PR base', async () => {
    const f = fixture()
    f.setMeta({ ...base, linkedPR: 8 })
    const result = updateRuntimeManagedWorktreeMetadata({
      selector: `id:${f.worktree.id}`,
      updates: { ...f.updates, lineage: { noParent: true } },
      store: f.store,
      ports: f.ports
    })
    await expect(result).rejects.toThrow('github_link_conflict')
    expect(f.removeWorktreeLineage).not.toHaveBeenCalled()
    expect(f.removeWorkspaceLineage).not.toHaveBeenCalled()
  })

  it('checks the live base after an asynchronous parent lookup and before lineage writes', async () => {
    const f = fixture()
    let release!: () => void
    let started!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    const lookupStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    f.ports.resolveWorktree.mockImplementation(async (selector) => {
      if (selector === 'parent') {
        started()
        await waiting
        return { ...f.worktree, id: 'repo::/parent', instanceId: 'parent-instance' }
      }
      return f.worktree
    })
    const result = updateRuntimeManagedWorktreeMetadata({
      selector: `id:${f.worktree.id}`,
      updates: { ...f.updates, lineage: { parentWorktree: 'parent' } },
      store: f.store,
      ports: f.ports
    })
    const refusal = expect(result).rejects.toThrow('github_link_conflict')
    await lookupStarted
    f.setMeta({ ...base, linkedPR: 8 })
    release()
    await refusal
    expect(f.setWorktreeLineage).not.toHaveBeenCalled()
    expect(f.setWorkspaceLineage).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('supports an auto-discovered PR with no explicit stored PR and returns actual saved metadata', async () => {
    const f = fixture()
    f.updates.githubLinkBase.linkedPR = null
    f.setMeta({ ...base, linkedPR: null })
    const result = await f.run()
    expect(result).toMatchObject({ linkedPR: null, suppressedGitHubPR: 7 })
    expect(f.getAllWorktreeMetaForHost).toHaveBeenCalledWith('ssh:build-box')
    expect(f.getWorktreeMetaForHost).not.toHaveBeenCalled()
    expect(f.getWorktreeMeta).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).toHaveBeenCalledWith(
      hostWorktreeTarget({ id: f.worktree.id, hostId: 'ssh:build-box' }),
      { linkedPR: null, suppressedGitHubPR: 7 }
    )
  })

  it('does not use an unqualified metadata reader for a remote host', async () => {
    const f = fixture()
    delete f.store.getWorktreeMetaForHost
    delete f.store.getAllWorktreeMetaForHost
    await expect(f.run()).rejects.toThrow('github_link_unavailable')
    expect(f.getWorktreeMeta).not.toHaveBeenCalled()
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses a resolved workspace whose instance differs from the captured base', async () => {
    const f = fixture()
    f.worktree.instanceId = 'replacement-instance'
    await expect(f.run()).rejects.toThrow('github_link_conflict')
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it.each(['before lookup', 'during final lookup'] as const)(
    'refuses a host writer missing %s before removing lineage',
    async (when) => {
      const f = fixture()
      if (when === 'before lookup') {
        Reflect.deleteProperty(f.store, 'setWorktreeMeta')
      } else {
        f.ports.resolveWorktree
          .mockResolvedValueOnce(f.worktree)
          .mockImplementationOnce(async () => {
            Reflect.deleteProperty(f.store, 'setWorktreeMeta')
            return f.worktree
          })
      }
      await expect(
        updateRuntimeManagedWorktreeMetadata({
          selector: `id:${f.worktree.id}`,
          updates: { ...f.updates, lineage: { noParent: true } },
          store: f.store,
          ports: f.ports
        })
      ).rejects.toThrow('github_link_unavailable')
      expect(f.removeWorktreeLineage).not.toHaveBeenCalled()
      expect(f.removeWorkspaceLineage).not.toHaveBeenCalled()
      expect(f.setWorktreeMeta).not.toHaveBeenCalled()
    }
  )

  it('rejects owner movement when the primary is resolved again', async () => {
    const f = fixture()
    f.ports.resolveWorktree
      .mockResolvedValueOnce(f.worktree)
      .mockResolvedValueOnce({ ...f.worktree, hostId: 'ssh:replacement' })
    await expect(f.run()).rejects.toThrow('github_link_conflict')
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('refuses conflicting explicit workspace owner fields', async () => {
    const f = fixture()
    Object.assign(f.worktree, { identity: { executionHostId: 'ssh:other' } })
    await expect(f.run()).rejects.toThrow('github_link_conflict')
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })

  it('keeps a first metadata write valid without inventing an existing instance', async () => {
    const f = fixture()
    f.worktree.instanceId = undefined
    f.updates.githubLinkBase = { ...base, instanceId: null, linkedPR: null }
    f.setMeta(undefined)
    const result = await f.run()
    expect(result).toMatchObject({
      linkedPR: null,
      suppressedGitHubPR: 7,
      instanceId: 'created-instance'
    })
  })

  it('rejects an unqualified row returned by a host projection', async () => {
    const f = fixture()
    f.setMeta({ instanceId: base.instanceId ?? undefined, linkedPR: 7 })
    await expect(f.run()).rejects.toThrow('github_link_unavailable')
    expect(f.setWorktreeMeta).not.toHaveBeenCalled()
  })
})

describe('current unlink wire contract', () => {
  it.each([{ linkedPR: null }, { suppressedGitHubPR: 7 }, { suppressedGitHubPR: null }])(
    'requires a caller snapshot for a destructive PR metadata edit: %o',
    (edit) => {
      expect(WorktreeSet.safeParse({ worktree: 'id:repo::/workspace', ...edit }).success).toBe(
        false
      )
    }
  )
  it('retains the complete snapshot for the actual producer', () => {
    const parsed = WorktreeSet.parse({
      worktree: 'id:repo::/workspace',
      linkedPR: null,
      suppressedGitHubPR: 7,
      githubLinkBase: base
    })
    expect(Reflect.get(parsed, 'githubLinkBase')).toEqual(base)
  })
  it('keeps unrelated metadata and explicit positive linking valid', () => {
    expect(
      WorktreeSet.safeParse({ worktree: 'id:repo::/workspace', comment: 'note' }).success
    ).toBe(true)
    expect(WorktreeSet.safeParse({ worktree: 'id:repo::/workspace', linkedPR: 8 }).success).toBe(
      true
    )
  })
})
