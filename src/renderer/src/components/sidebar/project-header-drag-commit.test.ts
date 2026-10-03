// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { commitProjectHeaderDragDrop } from './project-header-drag-commit'
import type { ProjectHeaderDragSession } from './project-header-drag-contract'
import type { Repo } from '../../../../shared/repo-types'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/${id}`,
    displayName: id,
    badgeColor: '#000',
    addedAt: 0,
    ...overrides
  } as Repo
}

function makeSession(
  repoId: string,
  sidebarRepoHeaderIds: readonly string[],
  bucketKey = 'ungrouped',
  sourceExecutionHostId: ProjectHeaderDragSession['sourceExecutionHostId'] = 'local'
): ProjectHeaderDragSession {
  return {
    repoId,
    bucketKey,
    sidebarRepoHeaderIds,
    sourceExecutionHostId,
    pointerId: 1,
    headerRects: [],
    dropZones: [],
    handleEl: document.createElement('div'),
    startX: 0,
    startY: 0,
    latestPointerY: 0,
    promoted: true
  }
}

describe('commitProjectHeaderDragDrop', () => {
  it('commits whole-repo reordering when project groups are absent', () => {
    const onCommitRepoOrder = vi.fn()
    const repos = [makeRepo('a'), makeRepo('b'), makeRepo('c')]
    const repoById = new Map(repos.map((repo) => [repo.id, repo]))

    commitProjectHeaderDragDrop({
      session: makeSession('c', ['a', 'b', 'c']),
      sidebarDropIndex: 0,
      targetBucketKey: 'ungrouped',
      targetSidebarRepoHeaderIds: ['a', 'b', 'c'],
      orderedRepoIds: ['a', 'b', 'c'],
      repoById,
      usesProjectGroupOrdering: false,
      projectGroupHostIdByGroupId: new Map(),
      onCommitRepoOrder,
      onCommitProjectGroupOrder: vi.fn()
    })

    expect(onCommitRepoOrder).toHaveBeenCalledWith(['c', 'a', 'b'])
  })

  it('moves a merged paired-host header upward as one stable block', () => {
    const onCommitRepoOrder = vi.fn()
    const repos = [makeRepo('b'), makeRepo('same'), makeRepo('c')]
    const repoById = new Map(repos.map((repo) => [repo.id, repo]))

    commitProjectHeaderDragDrop({
      session: makeSession('same', ['b', 'same', 'c']),
      sidebarDropIndex: 0,
      targetBucketKey: 'ungrouped',
      targetSidebarRepoHeaderIds: ['b', 'same', 'c'],
      orderedRepoIds: ['b', 'same', 'c', 'same'],
      repoById,
      usesProjectGroupOrdering: false,
      projectGroupHostIdByGroupId: new Map(),
      onCommitRepoOrder,
      onCommitProjectGroupOrder: vi.fn()
    })

    expect(onCommitRepoOrder).toHaveBeenCalledWith(['same', 'same', 'b', 'c'])
  })

  it('does not reorder host occurrences when a merged header stays in place', () => {
    const onCommitRepoOrder = vi.fn()
    const repos = [makeRepo('b'), makeRepo('same'), makeRepo('c')]
    const repoById = new Map(repos.map((repo) => [repo.id, repo]))

    commitProjectHeaderDragDrop({
      session: makeSession('same', ['b', 'same', 'c']),
      sidebarDropIndex: 2,
      targetBucketKey: 'ungrouped',
      targetSidebarRepoHeaderIds: ['b', 'same', 'c'],
      orderedRepoIds: ['b', 'same', 'c', 'same'],
      repoById,
      usesProjectGroupOrdering: false,
      projectGroupHostIdByGroupId: new Map(),
      onCommitRepoOrder,
      onCommitProjectGroupOrder: vi.fn()
    })

    expect(onCommitRepoOrder).not.toHaveBeenCalled()
  })

  it('commits projectGroupOrder when project groups are present', () => {
    const onCommitProjectGroupOrder = vi.fn()
    const repos = [
      makeRepo('a', { projectGroupId: 'group-1' }),
      makeRepo('b', { projectGroupId: 'group-1' }),
      makeRepo('c', { projectGroupId: 'group-1' })
    ]
    const repoById = new Map(repos.map((repo) => [repo.id, repo]))

    commitProjectHeaderDragDrop({
      session: makeSession('c', ['a', 'b', 'c'], 'group:group-1'),
      sidebarDropIndex: 0,
      targetBucketKey: 'group:group-1',
      targetSidebarRepoHeaderIds: ['a', 'b', 'c'],
      orderedRepoIds: ['a', 'b', 'c'],
      repoById,
      usesProjectGroupOrdering: true,
      projectGroupHostIdByGroupId: new Map([['group-1', 'local']]),
      onCommitRepoOrder: vi.fn(),
      onCommitProjectGroupOrder
    })

    expect(onCommitProjectGroupOrder).toHaveBeenCalledWith('c', 'group-1', -1, 'local')
  })

  it('moves a project from one group into the actual target group slot', () => {
    const onCommitProjectGroupOrder = vi.fn()
    const repos = [
      makeRepo('a', { projectGroupId: 'group-a' }),
      makeRepo('b', { projectGroupId: 'group-b', projectGroupOrder: 0 }),
      makeRepo('c', { projectGroupId: 'group-b', projectGroupOrder: 10 })
    ]

    commitProjectHeaderDragDrop({
      session: makeSession('a', ['a'], 'group:group-a', 'runtime:env-dragged'),
      sidebarDropIndex: 1,
      targetBucketKey: 'group:group-b',
      targetSidebarRepoHeaderIds: ['b', 'c'],
      orderedRepoIds: ['a', 'b', 'c'],
      repoById: new Map(repos.map((repo) => [repo.id, repo])),
      usesProjectGroupOrdering: true,
      projectGroupHostIdByGroupId: new Map([
        ['group-a', 'runtime:env-dragged'],
        ['group-b', 'runtime:env-dragged']
      ]),
      onCommitRepoOrder: vi.fn(),
      onCommitProjectGroupOrder
    })

    expect(onCommitProjectGroupOrder).toHaveBeenCalledWith('a', 'group-b', 5, 'runtime:env-dragged')
  })

  it('moves a grouped project into the ungrouped bucket', () => {
    const onCommitProjectGroupOrder = vi.fn()
    const repos = [
      makeRepo('a', { projectGroupId: 'group-a' }),
      makeRepo('loose', { projectGroupOrder: 0 })
    ]

    commitProjectHeaderDragDrop({
      session: makeSession('a', ['a'], 'group:group-a'),
      sidebarDropIndex: 1,
      targetBucketKey: 'ungrouped',
      targetSidebarRepoHeaderIds: ['loose'],
      orderedRepoIds: ['a', 'loose'],
      repoById: new Map(repos.map((repo) => [repo.id, repo])),
      usesProjectGroupOrdering: true,
      projectGroupHostIdByGroupId: new Map([['group-a', 'local']]),
      onCommitRepoOrder: vi.fn(),
      onCommitProjectGroupOrder
    })

    expect(onCommitProjectGroupOrder).toHaveBeenCalledWith('a', null, 1, 'local')
  })

  it('rejects a target group owned by another execution host', () => {
    const onCommitProjectGroupOrder = vi.fn()
    const repos = [makeRepo('a', { projectGroupId: 'group-a' }), makeRepo('b')]

    commitProjectHeaderDragDrop({
      session: makeSession('a', ['a'], 'group:group-a'),
      sidebarDropIndex: 0,
      targetBucketKey: 'group:remote-group',
      targetSidebarRepoHeaderIds: ['b'],
      orderedRepoIds: ['a', 'b'],
      repoById: new Map(repos.map((repo) => [repo.id, repo])),
      usesProjectGroupOrdering: true,
      projectGroupHostIdByGroupId: new Map([['remote-group', 'runtime:remote']]),
      onCommitRepoOrder: vi.fn(),
      onCommitProjectGroupOrder
    })

    expect(onCommitProjectGroupOrder).not.toHaveBeenCalled()
  })

  it('rejects an ambiguous same-id group shared by multiple hosts', () => {
    const onCommitProjectGroupOrder = vi.fn()
    const repos = [
      makeRepo('a', { projectGroupId: 'shared' }),
      makeRepo('b', { projectGroupId: 'shared' })
    ]

    commitProjectHeaderDragDrop({
      session: makeSession('a', ['a', 'b'], 'group:shared'),
      sidebarDropIndex: 2,
      targetBucketKey: 'group:shared',
      targetSidebarRepoHeaderIds: ['a', 'b'],
      orderedRepoIds: ['a', 'b'],
      repoById: new Map(repos.map((repo) => [repo.id, repo])),
      usesProjectGroupOrdering: true,
      projectGroupHostIdByGroupId: new Map([['shared', null]]),
      onCommitRepoOrder: vi.fn(),
      onCommitProjectGroupOrder
    })

    expect(onCommitProjectGroupOrder).not.toHaveBeenCalled()
  })
})
