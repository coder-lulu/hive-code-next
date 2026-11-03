import type { GitPushTarget, Worktree } from '../../shared/worktree/types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import type { GitHubLinkBase } from '../../shared/worktree/github-link-base'
import { worktreeWorkspaceKey } from '../../shared/workspace-scope'
import { splitWorktreeId } from '../../shared/worktree/id'
import { getRepoRegistrationHostIds } from '../../shared/repo-host-identity'
import type { WorktreeSortOrderUpdate } from '../../shared/worktree/sort-order-update'
import { worktreeRowTarget } from '../persistence/host-qualified-worktree-meta'
import {
  writeWorktreeSortOrder,
  type WorktreeSortOrderRequest
} from '../persistence/worktree-sort-order-write'
import { stripOrcaProvenanceMetaUpdates } from '../worktree-removal-safety'
import { isRemovedFolderWorkspaceInstance } from '../folder-workspace-meta-presence'
import type { RuntimeStore } from './runtime-store-contract'
import {
  isWslMoveSourceHost,
  isWslMoveWorkspaceBlocked,
  shouldDropWslMoveProjectUpdate,
  wslMoveProjectRefForWorkspace,
  WslMoveProjectFencedError
} from '../persistence/moving-wsl-projects/wsl-move-scope-guard'
import { RuntimeLineageError } from './runtime-worktree-lineage-resolution'
import type { ResolvedWorktree } from './runtime-worktree-path-identity'

export type RuntimeManagedWorktreeMetadataUpdates = Omit<Partial<WorktreeMeta>, 'pushTarget'> & {
  pushTarget?: GitPushTarget | null
  lineage?: { parentWorktree?: string; noParent?: boolean }
  githubLinkBase?: GitHubLinkBase
}

type Ports = {
  resolveWorktree: (selector: string) => Promise<ResolvedWorktree>
  validateParent: (worktree: ResolvedWorktree, parent: ResolvedWorktree) => void
  invalidateResolved: () => void
  invalidateScan: (repoId: string) => void
  notifyChanged: (repoId: string) => void
  showWorktree: (selector: string) => Promise<Worktree>
}

export async function updateRuntimeManagedWorktreeMetadata(args: {
  selector: string
  updates: RuntimeManagedWorktreeMetadataUpdates
  store: RuntimeStore
  ports: Ports
}): Promise<Worktree> {
  const worktree = await args.ports.resolveWorktree(args.selector)
  const { lineage, githubLinkBase, ...metaUpdates } = args.updates
  const executionHostId = worktree.identity?.executionHostId ?? worktree.hostId
  const target = worktreeRowTarget(args.store, { id: worktree.id, hostId: executionHostId })
  if (!target) {
    throw new Error('selector_ambiguous')
  }
  const previousParentRepoId = lineage
    ? splitWorktreeId(args.store.getWorktreeLineage?.(worktree.id)?.parentWorktreeId ?? '')?.repoId
    : undefined
  const initialPath = worktree.path
  if (githubLinkBase) {
    requireGitHubLinkOwner(worktree, githubLinkBase)
  }
  if (
    isWslMoveSourceHost(executionHostId) &&
    shouldDropWslMoveProjectUpdate(
      args.store,
      wslMoveProjectRefForWorkspace(worktree.id),
      lineage ? args.updates : metaUpdates
    )
  ) {
    if (githubLinkBase) {
      throw new WslMoveProjectFencedError()
    }
    return worktree
  }
  if (lineage?.parentWorktree) {
    args.ports.invalidateResolved()
    args.ports.invalidateScan(worktree.repoId)
  }
  const clearPushTarget =
    Object.hasOwn(metaUpdates, 'pushTarget') && metaUpdates.pushTarget === null
  const normalized: Partial<WorktreeMeta> = clearPushTarget
    ? { ...metaUpdates, pushTarget: undefined }
    : (metaUpdates as Partial<WorktreeMeta>)
  const persisted: Partial<WorktreeMeta> = omitUndefinedProperties(
    normalized.displayName !== undefined
      ? {
          ...normalized,
          pendingFirstAgentMessageRename: false,
          firstAgentMessageRenameError: null
        }
      : normalized
  )
  if (clearPushTarget) {
    persisted.pushTarget = undefined
  }
  let parent: ResolvedWorktree | undefined
  if (lineage?.parentWorktree) {
    parent = await args.ports.resolveWorktree(lineage.parentWorktree)
    // Keep the captured parent identity stable across the final primary lookup.
    parent = { ...parent, identity: parent.identity ? { ...parent.identity } : undefined }
    args.ports.validateParent(worktree, parent)
    if (!worktree.instanceId || !parent.instanceId) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_MISSING',
        'Worktree instance identity was unavailable.'
      )
    }
    if (!args.store.setWorktreeLineage) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_MISSING',
        'Worktree lineage storage was unavailable.'
      )
    }
  }
  if (githubLinkBase) {
    // Resolve again after async parent lookup; the original owner can move meanwhile.
    args.ports.invalidateResolved()
    const current = await args.ports.resolveWorktree(args.selector)
    const currentHost = requireGitHubLinkOwner(current, githubLinkBase)
    if (typeof args.store.setWorktreeMeta !== 'function') {
      throw new Error('github_link_unavailable')
    }
    if (
      current.id !== worktree.id ||
      current.repoId !== worktree.repoId ||
      current.path !== initialPath
    ) {
      throw new Error('github_link_conflict')
    }
    let meta: Partial<WorktreeMeta> | undefined
    if (args.store.getAllWorktreeMetaForHost) {
      // This projection is read-only; the single-row getter may hydrate old locator rows.
      meta = args.store.getAllWorktreeMetaForHost(currentHost)[current.id]
      if (
        meta &&
        meta.hostId !== currentHost &&
        !(currentHost === 'local' && meta.hostId === undefined)
      ) {
        throw new Error('github_link_unavailable')
      }
    } else {
      throw new Error('github_link_unavailable')
    }
    if (
      (meta?.instanceId ?? null) !== githubLinkBase.instanceId ||
      (meta?.linkedPR ?? null) !== githubLinkBase.linkedPR ||
      (meta?.suppressedGitHubPR ?? null) !== githubLinkBase.suppressedGitHubPR
    ) {
      throw new Error('github_link_conflict')
    }
    if (
      isWslMoveSourceHost(currentHost) &&
      shouldDropWslMoveProjectUpdate(
        args.store,
        wslMoveProjectRefForWorkspace(current.id),
        lineage ? { ...metaUpdates, lineage } : metaUpdates
      )
    ) {
      throw new WslMoveProjectFencedError()
    }
    if (parent) {
      requireCurrentParent(args.store, parent)
    }
  }
  // All refusal checks precede either lineage or metadata writes.
  if (isRemovedFolderWorkspaceInstance(args.store, worktree.id, executionHostId)) {
    throw new Error('selector_not_found')
  }
  if (lineage?.noParent === true) {
    args.store.removeWorktreeLineage?.(target)
  } else if (parent && worktree.instanceId && parent.instanceId && args.store.setWorktreeLineage) {
    const createdAt = Date.now()
    const recorded = args.store.setWorktreeLineage(target, {
      worktreeId: worktree.id,
      worktreeInstanceId: worktree.instanceId,
      parentWorktreeId: parent.id,
      parentWorktreeInstanceId: parent.instanceId,
      origin: 'manual',
      capture: { source: 'manual-action', confidence: 'explicit' },
      createdAt
    })
    if (!recorded) {
      throw new RuntimeLineageError(
        'LINEAGE_PARENT_CONTEXT_CONFLICT',
        'A same-id workspace on another host owns this lineage.'
      )
    }
    args.store.setWorkspaceLineage?.({
      childWorkspaceKey: worktreeWorkspaceKey(worktree.id),
      childInstanceId: worktree.instanceId,
      parentWorkspaceKey: worktreeWorkspaceKey(parent.id),
      parentInstanceId: parent.instanceId,
      origin: 'manual',
      capture: { source: 'manual-action', confidence: 'explicit' },
      createdAt
    })
  }
  const metadataUpdates = stripOrcaProvenanceMetaUpdates(persisted)
  args.store.setWorktreeMeta(target, metadataUpdates)
  // Why: CLI callers need an explicit push for metadata changed outside the renderer's optimistic update path.
  args.ports.invalidateResolved()
  args.ports.notifyChanged(worktree.repoId)
  if (lineage) {
    for (const repoId of new Set([previousParentRepoId, parent?.repoId])) {
      if (repoId && repoId !== worktree.repoId) {
        args.ports.notifyChanged(repoId)
      }
    }
  }
  return args.ports.showWorktree(`id:${worktree.id}`)
}

function requireCurrentParent(store: RuntimeStore, parent: ResolvedWorktree): void {
  const hostId = parent.identity?.executionHostId ?? parent.hostId
  if (!hostId || !store.getAllWorktreeMetaForHost) {
    throw new Error('github_link_unavailable')
  }
  const meta = store.getAllWorktreeMetaForHost(hostId)[parent.id]
  if (
    (parent.hostId !== undefined && parent.hostId !== hostId) ||
    !meta ||
    meta.instanceId !== parent.instanceId ||
    (meta.hostId !== hostId && !(hostId === 'local' && meta.hostId === undefined))
  ) {
    throw new Error('github_link_conflict')
  }
  if (isWslMoveSourceHost(hostId) && isWslMoveWorkspaceBlocked(store, parent.id)) {
    throw new WslMoveProjectFencedError()
  }
}

function requireGitHubLinkOwner(worktree: ResolvedWorktree, base: GitHubLinkBase) {
  const identityHost = worktree.identity?.executionHostId
  if (
    identityHost !== undefined &&
    worktree.hostId !== undefined &&
    identityHost !== worktree.hostId
  ) {
    throw new Error('github_link_conflict')
  }
  const hostId = identityHost ?? worktree.hostId
  if (!hostId) {
    throw new Error('github_link_unavailable')
  }
  if (hostId !== base.hostId || (worktree.instanceId ?? null) !== base.instanceId) {
    throw new Error('github_link_conflict')
  }
  return hostId
}

export function persistRuntimeManagedWorktreeSortOrder(args: {
  orderedIds: WorktreeSortOrderRequest['orderedIds']
  hostIds?: WorktreeSortOrderRequest['hostIds']
  store: RuntimeStore
  invalidateResolved: () => void
  /** `sortOrders` omitted: the repo has same-id copies, which an id-keyed patch cannot tell apart. */
  notifyChanged: (repoId: string, sortOrders?: WorktreeSortOrderUpdate[]) => void
}): { updated: number } {
  // Skip moving projects but save/publish the rest; report only written orders.
  const updates = writeWorktreeSortOrder(
    args.store,
    { orderedIds: args.orderedIds, hostIds: args.hostIds },
    (worktreeId) => isWslMoveWorkspaceBlocked(args.store, worktreeId),
    Date.now()
  )
  if (updates.length === 0) {
    return { updated: 0 }
  }
  args.invalidateResolved()
  const updatesByRepo = new Map<string, WorktreeSortOrderUpdate[]>()
  for (const update of updates) {
    const repoId = splitWorktreeId(update.worktreeId)?.repoId
    if (repoId) {
      updatesByRepo.set(repoId, [...(updatesByRepo.get(repoId) ?? []), update])
    }
  }
  for (const [repoId, sortOrders] of updatesByRepo) {
    const isTwin = getRepoRegistrationHostIds(args.store.getRepos(), repoId).size > 1
    args.notifyChanged(repoId, isTwin ? undefined : sortOrders)
  }
  return { updated: updates.length }
}

function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>
}
