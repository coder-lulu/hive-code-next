import type { PointerEvent } from 'react'

import {
  getProjectHeaderDragBucketKey,
  measureProjectHeaderDragRects,
  measureProjectHeaderDropZones,
  type ProjectHeaderDragBucketKey
} from './project-header-drop'
import {
  isProjectHeaderDragHandleTarget,
  isRepoHeaderActionTarget,
  type ProjectHeaderDragSession
} from './project-header-drag-contract'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'

export function createProjectHeaderDragSession(args: {
  event: PointerEvent<HTMLElement>
  repo: Repo
  sidebarRepoHeaderIdsByBucket: ReadonlyMap<ProjectHeaderDragBucketKey, readonly string[]>
  canMoveAcrossProjectGroups: boolean
  getScrollContainer: () => HTMLElement | null
}): ProjectHeaderDragSession | null {
  if (args.event.button !== 0) {
    return null
  }
  if (!isProjectHeaderDragHandleTarget(args.event.target, args.event.currentTarget)) {
    return null
  }
  if (isRepoHeaderActionTarget(args.event.target, args.event.currentTarget)) {
    return null
  }
  const bucketKey = getProjectHeaderDragBucketKey(args.repo)
  const sidebarRepoHeaderIds = args.sidebarRepoHeaderIdsByBucket.get(bucketKey) ?? []
  // A lone sibling can still leave its current group. Preserve the old
  // click-only behavior only when cross-group movement is unavailable.
  if (sidebarRepoHeaderIds.length <= 1 && !args.canMoveAcrossProjectGroups) {
    return null
  }
  const container = args.getScrollContainer()
  if (!container) {
    return null
  }
  const handleEl = args.event.currentTarget
  // Why: defer setPointerCapture until the drag threshold is crossed so a
  // header click still reaches the inner collapse handler on pointerup.
  return {
    repoId: args.repo.id,
    bucketKey,
    sidebarRepoHeaderIds,
    sourceExecutionHostId: getRepoExecutionHostId(args.repo),
    pointerId: args.event.pointerId,
    headerRects: measureProjectHeaderDragRects(container),
    dropZones: measureProjectHeaderDropZones(container),
    handleEl,
    startX: args.event.clientX,
    startY: args.event.clientY,
    latestPointerY: args.event.clientY,
    promoted: false
  }
}
