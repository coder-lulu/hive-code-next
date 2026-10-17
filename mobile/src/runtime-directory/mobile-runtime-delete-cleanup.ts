import { clearHostHomeSnapshot } from '../cache/home-snapshot-cache'
import { clearCachedWorktrees } from '../cache/worktree-cache'
import { clearCachedRepos } from '../cache/repo-cache'
import { persistMirrored, readMirroredKeyOrStore } from '../storage/mirrored-storage-keys'
import { removeHostAndCloseClient } from '../transport/host-removal-lifecycle'
import {
  LAST_VISITED_WORKTREE_STORAGE_KEY,
  readLastVisitedWorktreeRecord
} from '../worktree/last-visited-worktree-repo'
import { notifyLocalRuntimeConnectionsChanged } from './local-runtime-connections-changed'

import {
  loadRuntimeDeleteRecoveryAliases,
  type CapturedRuntimeDeleteAlias
} from './mobile-runtime-delete-recovery'

const cleanupFlights = new Map<string, Promise<void>>()

export function runtimeDeletionSupportedOnThisSurface(): boolean {
  return true
}

async function clearConnections(
  runtimeRecordId: string,
  forgetHostClient: (hostId: string) => void,
  isCurrent: () => boolean,
  capturedAliases?: readonly CapturedRuntimeDeleteAlias[]
): Promise<void> {
  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new Error('mobile_session_required')
    }
  }
  assertCurrent()
  const aliases = capturedAliases ?? (await loadRuntimeDeleteRecoveryAliases(runtimeRecordId))
  assertCurrent()
  for (const { hostId, pairingRevision } of aliases) {
    assertCurrent()
    await removeHostAndCloseClient(hostId, forgetHostClient, pairingRevision, async () => {
      assertCurrent()
      notifyLocalRuntimeConnectionsChanged([hostId])
      clearCachedWorktrees(hostId)
      clearCachedRepos(hostId)
      await clearHostHomeSnapshot(hostId, isCurrent)
      assertCurrent()
      const lastVisited = readLastVisitedWorktreeRecord(
        await readMirroredKeyOrStore(LAST_VISITED_WORKTREE_STORAGE_KEY)
      )
      assertCurrent()
      if (lastVisited?.hostId === hostId) {
        await persistMirrored(LAST_VISITED_WORKTREE_STORAGE_KEY, null)
        assertCurrent()
      }
    })
    assertCurrent()
  }
}

export async function clearUnlinkedRuntimeConnections(
  runtimeRecordId: string,
  forgetHostClient: (hostId: string) => void,
  isCurrent: () => boolean,
  capturedAliases?: readonly CapturedRuntimeDeleteAlias[]
): Promise<void> {
  const previous = cleanupFlights.get(runtimeRecordId)
  const pending = (async () => {
    if (previous) {
      await previous.catch(() => undefined)
    }
    if (!isCurrent()) {
      throw new Error('mobile_session_required')
    }
    await clearConnections(runtimeRecordId, forgetHostClient, isCurrent, capturedAliases)
  })()
  cleanupFlights.set(runtimeRecordId, pending)
  try {
    await pending
  } finally {
    if (cleanupFlights.get(runtimeRecordId) === pending) {
      cleanupFlights.delete(runtimeRecordId)
    }
  }
}
