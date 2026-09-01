import {
  applyAllRepoInsertAt,
  getLogicalRepoOrderRankById,
  getProjectGroupOrderForSidebarDrop,
  getProjectGroupIdFromHeaderDragBucketKey,
  isProjectHeaderDropBucketHostCompatible,
  mapSidebarProjectHeaderDropIndexToSiblingInsertIndex,
  mapSidebarRepoDropIndexToAllRepoInsertAt,
  type ProjectHeaderDragBucketKey
} from './project-header-drop'
import type { ProjectHeaderDragSession } from './project-header-drag-contract'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'

export function commitProjectHeaderDragDrop(args: {
  session: ProjectHeaderDragSession
  sidebarDropIndex: number
  targetBucketKey: ProjectHeaderDragBucketKey
  targetSidebarRepoHeaderIds: readonly string[]
  orderedRepoIds: readonly string[]
  repoById: ReadonlyMap<string, Repo>
  usesProjectGroupOrdering: boolean
  projectGroupHostIdByGroupId: ReadonlyMap<string, ExecutionHostId | null>
  onCommitRepoOrder: (orderedIds: string[]) => void
  onCommitProjectGroupOrder: (
    repoId: string,
    projectGroupId: string | null,
    order: number,
    sourceExecutionHostId: ExecutionHostId
  ) => void
}): void {
  const draggedRepo = args.repoById.get(args.session.repoId)
  if (!draggedRepo) {
    return
  }

  const sourceSidebarRepoHeaderIds = args.session.sidebarRepoHeaderIds
  const sourceIndex = sourceSidebarRepoHeaderIds.indexOf(args.session.repoId)
  const sameBucket = args.targetBucketKey === args.session.bucketKey
  // Why: both slots bordering the dragged header are visual no-ops. In
  // particular, do not compact paired-host occurrences on an unchanged drop.
  if (
    sourceIndex === -1 ||
    (sameBucket &&
      (args.sidebarDropIndex === sourceIndex || args.sidebarDropIndex === sourceIndex + 1))
  ) {
    return
  }

  if (args.usesProjectGroupOrdering) {
    if (
      !isProjectHeaderDropBucketHostCompatible({
        sourceBucketKey: args.session.bucketKey,
        targetBucketKey: args.targetBucketKey,
        sourceExecutionHostId: args.session.sourceExecutionHostId,
        projectGroupHostIdByGroupId: args.projectGroupHostIdByGroupId
      })
    ) {
      return
    }
    const targetProjectGroupId = getProjectGroupIdFromHeaderDragBucketKey(args.targetBucketKey)
    if (args.targetBucketKey !== 'ungrouped' && !targetProjectGroupId) {
      return
    }
    const siblings = args.targetSidebarRepoHeaderIds
      .filter((repoId) => repoId !== args.session.repoId)
      .map((repoId) => args.repoById.get(repoId))
      .filter((repo): repo is Repo => repo !== undefined)
    const siblingDropIndex = mapSidebarProjectHeaderDropIndexToSiblingInsertIndex({
      sidebarDropIndex: args.sidebarDropIndex,
      sourceIndex: sameBucket ? sourceIndex : -1,
      siblingCount: siblings.length
    })
    // Why: sourceIndex is the position in the original array (including the
    // dragged item), but siblingDropIndex is the position in the filtered
    // array. The equivalent position in the filtered array is the sourceIndex
    // capped at siblings.length (since removing an item can only shift indices
    // down by 1 when the removed item was before the insertion point).
    const sourceIndexInSiblings = Math.min(sourceIndex, siblings.length)
    if (sameBucket && siblingDropIndex === sourceIndexInSiblings) {
      return
    }
    const repoOrderRankById = getLogicalRepoOrderRankById(args.orderedRepoIds)
    const order = getProjectGroupOrderForSidebarDrop({
      siblings,
      dropIndex: siblingDropIndex,
      repoOrderRankById
    })
    args.onCommitProjectGroupOrder(
      args.session.repoId,
      targetProjectGroupId,
      order,
      args.session.sourceExecutionHostId
    )
    return
  }

  if (!sameBucket) {
    return
  }

  const insertAt = mapSidebarRepoDropIndexToAllRepoInsertAt(
    args.sidebarDropIndex,
    sourceSidebarRepoHeaderIds,
    args.orderedRepoIds
  )
  const next = applyAllRepoInsertAt(args.orderedRepoIds, args.session.repoId, insertAt)
  if (!next) {
    return
  }
  args.onCommitRepoOrder(next)
}
