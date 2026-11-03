import { HEADLESS_RUNTIME_WINDOW_ID } from '../../../shared/runtime-types'
import { OrcaRuntimeWithAttachWindow } from './session-graph-promotion'
import type {
  RuntimeMobileSessionTabsSnapshot,
  RuntimeSyncedLeaf
} from '../../../shared/runtime-types'
import type { RuntimeLeafRecord } from '../runtime-terminal-state-records'
import { certifyBoundRuntimeSurfaceIncarnation } from '../runtime-bound-surface-incarnation-certification'
import {
  collectRuntimeGraphSurfaceClaims,
  getPublishedRuntimeSurfacePtyId,
  repairPublishedRuntimeSurfaceProjection
} from './published-pty-surface-evidence'

export abstract class OrcaRuntimeWithRepairPublishedPtySurfaces extends OrcaRuntimeWithAttachWindow {
  // Remounts briefly clear ptyId; retain the live handle paired clients still use (#23759).
  protected isLeafRemountingLivePty(
    ptyId: string,
    incomingPtyIds: ReadonlySet<string | null>
  ): boolean {
    return (
      !incomingPtyIds.has(ptyId) &&
      this.controllerKnowsPtyIsLive(ptyId) &&
      this.getPtyLivenessVerdict(ptyId)?.status !== 'exited'
    )
  }

  shouldRelayTerminalBrowserOpens(): boolean {
    return this.authoritativeWindowId === HEADLESS_RUNTIME_WINDOW_ID
  }

  protected repairPublishedPtySurfaces(
    leaves: readonly RuntimeSyncedLeaf[],
    previousLeaves: ReadonlyMap<string, RuntimeLeafRecord>,
    previousSnapshots: ReadonlyMap<string, RuntimeMobileSessionTabsSnapshot>,
    incomingSnapshots: ReadonlyMap<string, RuntimeMobileSessionTabsSnapshot>,
    changedWorktrees: Set<string>,
    admission: {
      leafKey(tabId: string, leafId: string): string
      allowsPty(ptyId: string): boolean
    } = {
      leafKey: (tabId, leafId) => this.getLeafKey(tabId, leafId),
      allowsPty: (ptyId) => {
        const liveness = this.getPtyLivenessVerdict(ptyId)?.status
        return (
          !this.isPtyStopRequested(ptyId) && liveness !== 'exited' && liveness !== 'unverifiable'
        )
      }
    }
  ): { leaves: RuntimeSyncedLeaf[]; unmountedPtyIds: Set<string> } {
    const claims = collectRuntimeGraphSurfaceClaims(leaves)
    for (const leaf of leaves) {
      const pty = leaf.ptyId ? this.ptysById.get(leaf.ptyId) : undefined
      const incoming = incomingSnapshots.get(leaf.worktreeId)
      const current = this.mobileSessionTabsByWorktree.get(leaf.worktreeId)
      const accepted = this.acceptedRendererMobileSnapshotByWorktree.get(leaf.worktreeId)
      if (
        !pty ||
        !incoming ||
        !current ||
        accepted?.publicationEpoch !== incoming.publicationEpoch ||
        accepted.rendererVersion !== incoming.snapshotVersion ||
        claims.ptyCounts.get(pty.ptyId) !== 1 ||
        claims.paneCounts.get(leaf.tabId)?.get(leaf.leafId) !== 1 ||
        this.tabs.get(leaf.tabId)?.worktreeId !== leaf.worktreeId ||
        !admission.allowsPty(pty.ptyId)
      ) {
        continue
      }
      const certified = certifyBoundRuntimeSurfaceIncarnation(
        pty,
        leaf,
        previousSnapshots.get(leaf.worktreeId),
        incoming,
        current
      )
      if (certified) {
        this.storeMobileSessionSnapshot(leaf.worktreeId, certified)
        changedWorktrees.add(leaf.worktreeId)
      }
    }
    const candidates = [...leaves]
    for (const snapshot of incomingSnapshots.values()) {
      for (const surface of snapshot.tabs) {
        if (
          surface.type === 'terminal' &&
          !claims.paneCounts.get(surface.parentTabId)?.has(surface.leafId)
        ) {
          candidates.push({
            tabId: surface.parentTabId,
            worktreeId: snapshot.worktree,
            leafId: surface.leafId,
            paneRuntimeId: 0,
            ptyId: null
          })
        }
      }
    }
    const repairedPtyByPane = new Map<string, string>()
    const unmountedPtyIds = new Set<string>()
    for (const leaf of candidates) {
      const leafKey = admission.leafKey(leaf.tabId, leaf.leafId)
      const priorPtyId =
        previousLeaves.get(leafKey)?.ptyId ??
        getPublishedRuntimeSurfacePtyId(leaf, previousSnapshots.get(leaf.worktreeId))
      const pty = priorPtyId ? this.ptysById.get(priorPtyId) : undefined
      const count = claims.paneCounts.get(leaf.tabId)?.get(leaf.leafId)
      const tab = this.tabs.get(leaf.tabId)
      if (
        !pty ||
        (count !== undefined && count !== 1) ||
        claims.ptyIds.has(pty.ptyId) ||
        (tab ? tab.worktreeId !== leaf.worktreeId : count !== undefined) ||
        !admission.allowsPty(pty.ptyId)
      ) {
        continue
      }
      const repaired = repairPublishedRuntimeSurfaceProjection(
        pty,
        leaf,
        previousSnapshots.get(leaf.worktreeId),
        incomingSnapshots.get(leaf.worktreeId),
        this.mobileSessionTabsByWorktree.get(leaf.worktreeId)
      )
      if (!repaired) {
        continue
      }
      if (repaired !== this.mobileSessionTabsByWorktree.get(leaf.worktreeId)) {
        this.storeMobileSessionSnapshot(leaf.worktreeId, repaired)
        changedWorktrees.add(leaf.worktreeId)
      }
      repairedPtyByPane.set(leafKey, pty.ptyId)
      if (count === undefined) {
        unmountedPtyIds.add(pty.ptyId)
      }
    }
    return {
      leaves: leaves.map((leaf) => {
        const ptyId = repairedPtyByPane.get(admission.leafKey(leaf.tabId, leaf.leafId))
        return ptyId ? { ...leaf, ptyId } : leaf
      }),
      unmountedPtyIds
    }
  }
}
