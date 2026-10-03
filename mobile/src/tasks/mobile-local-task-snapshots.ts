import type {
  MobileLocalSessionInventory,
  MobileLocalSessionSnapshot,
  MobileLocalSessionUpdate
} from './mobile-local-task-model'

function isUnpublishedPlaceholder(snapshot: MobileLocalSessionSnapshot): boolean {
  return snapshot.publicationEpoch === 'none' && snapshot.snapshotVersion === 0
}

function shouldReplaceSnapshot(
  current: MobileLocalSessionSnapshot | undefined,
  incoming: MobileLocalSessionSnapshot
): boolean {
  if (!current) {
    return !isUnpublishedPlaceholder(incoming)
  }
  if (isUnpublishedPlaceholder(incoming)) {
    return false
  }
  return (
    incoming.publicationEpoch !== current.publicationEpoch ||
    incoming.snapshotVersion >= current.snapshotVersion
  )
}

/**
 * Applies a census without treating a non-authoritative inventory or an unpublished placeholder
 * as proof that retained session rows disappeared.
 */
export function mergeMobileLocalSessionInventory(
  current: readonly MobileLocalSessionSnapshot[],
  inventory: MobileLocalSessionInventory
): MobileLocalSessionSnapshot[] {
  const currentByWorktree = new Map(current.map((snapshot) => [snapshot.worktreeId, snapshot]))
  const nextByWorktree = inventory.authoritative
    ? new Map<string, MobileLocalSessionSnapshot>()
    : new Map(currentByWorktree)

  for (const incoming of inventory.snapshots) {
    const previous = currentByWorktree.get(incoming.worktreeId)
    if (isUnpublishedPlaceholder(incoming)) {
      if (inventory.authoritative && previous) {
        nextByWorktree.set(incoming.worktreeId, previous)
      }
      continue
    }
    const candidate = nextByWorktree.get(incoming.worktreeId) ?? previous
    if (shouldReplaceSnapshot(candidate, incoming)) {
      nextByWorktree.set(incoming.worktreeId, incoming)
    } else if (inventory.authoritative && previous) {
      nextByWorktree.set(incoming.worktreeId, previous)
    }
  }
  return [...nextByWorktree.values()]
}

/** Applies one live update and ignores a version that is stale within the same publication epoch. */
export function applyMobileLocalSessionUpdate(
  current: readonly MobileLocalSessionSnapshot[],
  update: MobileLocalSessionUpdate
): MobileLocalSessionSnapshot[] {
  const next = new Map(current.map((snapshot) => [snapshot.worktreeId, snapshot]))
  const previous = next.get(update.worktreeId)
  if (
    previous &&
    update.publicationEpoch === previous.publicationEpoch &&
    update.snapshotVersion < previous.snapshotVersion
  ) {
    return [...current]
  }
  if (update.removed) {
    next.delete(update.worktreeId)
  } else if (shouldReplaceSnapshot(previous, update)) {
    next.set(update.worktreeId, update)
  }
  return [...next.values()]
}
