/**
 * Whether the pane a PTY record names as its surface still exists and still holds it.
 *
 * Why a graph stamp and not self-consistency: a record whose `paneKey` parses to its own `tabId`
 * agrees with itself forever, so a terminal the graph had dropped read as attached under a `tabId`
 * no tab has (#18191). The stamp names the sequence a claim is good as of, so absence counts only
 * against a claim some graph statement had the standing to contradict — which a spawn ahead of the
 * graph (#7587) and a graph that went away (leaves cleared, sequence not bumped) do not.
 */
import { parsePaneKey } from '../../shared/stable-pane-id'
import type { RuntimeMobileSessionTabsSnapshot } from '../../shared/runtime-types'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'

export type RecordedPtySurface = {
  ptyId: string
  tabId: string | null
  paneKey: string | null
  /** Value of `graphSequence` when this surface was last written. */
  surfaceRecordedAtGraphSequence: number
}

/**
 * The standing a surface claim gets when its writer does not name one. A persisted replay, a stored
 * mobile snapshot and an inventory restore are all derived from a graph that has already had its
 * say, so none of them may speak over it — and defaulting the other way is what let the restore in
 * `terminal list` un-drop a pane the graph dropped (#18191).
 */
export const SURFACE_CLAIM_WITHOUT_STANDING = 0

/**
 * A spawn names its pane before the graph carrying it exists (#7587), so the one statement the
 * renderer may already have in flight is not silence about that pane. Renderer syncs are
 * serialized, so there is never more than one.
 */
export function spawnSurfaceClaimSequence(graphSequence: number): number {
  return graphSequence + 1
}

/** The one way to name a PTY's surface: a bare `paneKey =` leaves the stamp behind. */
export function recordPtySurfaceClaim(
  pty: RecordedPtySurface,
  paneKey: string | null,
  graphSequence: number
): void {
  // Replaying the claim already on the record is not new evidence, but it must not retract the
  // standing that claim already had.
  pty.surfaceRecordedAtGraphSequence =
    paneKey === pty.paneKey
      ? Math.max(pty.surfaceRecordedAtGraphSequence, graphSequence)
      : graphSequence
  pty.paneKey = paneKey
}

export function recordPtySurface(
  pty: RecordedPtySurface,
  tabId: string,
  paneKey: string,
  graphSequence: number
): void {
  pty.tabId = tabId
  recordPtySurfaceClaim(pty, paneKey, graphSequence)
}

export type PtySurfaceTopology = {
  /** Monotonic count of authoritative graph statements applied so far. */
  graphSequence: number
  /** The ptyId the graph currently binds to this pane, or undefined when it holds no such pane. */
  ptyIdHoldingPane: (tabId: string, leafId: string) => string | null | undefined
}

/**
 * True when the record names a pane the graph agrees this PTY occupies, or when nothing has had
 * the standing to contradict it yet. False is the reportable state: a live PTY with no surface.
 */
export function ptyHoldsRecordedSurface(
  pty: RecordedPtySurface,
  topology: PtySurfaceTopology
): boolean {
  const pane = parsePaneKey(pty.paneKey ?? '')
  if (!pty.tabId || !pane || pane.tabId !== pty.tabId) {
    return false
  }
  if (pty.surfaceRecordedAtGraphSequence >= topology.graphSequence) {
    return true
  }
  return topology.ptyIdHoldingPane(pane.tabId, pane.leafId) === pty.ptyId
}

/** Runtime publications also own surfaces that the desktop has never mounted. */
export function ptyHoldsPublishedRuntimeSurface(
  pty: Pick<
    RuntimePtyWorktreeRecord,
    | 'ptyId'
    | 'tabId'
    | 'paneKey'
    | 'worktreeId'
    | 'incarnationId'
    | 'connected'
    | 'runtimeSessionOwned'
  >,
  snapshot: RuntimeMobileSessionTabsSnapshot | undefined,
  topology: PtySurfaceTopology
): boolean {
  const pane = parsePaneKey(pty.paneKey ?? '')
  if (
    !pty.connected ||
    !pty.runtimeSessionOwned ||
    !pane ||
    pane.tabId !== pty.tabId ||
    snapshot?.worktree !== pty.worktreeId
  ) {
    return false
  }
  const graphPtyId = topology.ptyIdHoldingPane(pane.tabId, pane.leafId)
  if (graphPtyId !== undefined && graphPtyId !== pty.ptyId) {
    return false
  }
  return snapshot.tabs.some(
    (tab) =>
      tab.type === 'terminal' &&
      tab.parentTabId === pane.tabId &&
      tab.leafId === pane.leafId &&
      tab.ptyId === pty.ptyId &&
      (tab.incarnationId ?? null) === pty.incarnationId
  )
}
