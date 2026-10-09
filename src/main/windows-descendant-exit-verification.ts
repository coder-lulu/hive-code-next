import { collectDescendantsFromIndex, getProcessTableIndex } from '../shared/process-table-index'
import type { DescendantTreeVerdict } from './pty-descendant-exit-verification'
import {
  readWindowsProcessTableFresh,
  requestWindowsProcessTermination
} from './windows/windows-process-table'

export const WINDOWS_DESCENDANT_KILL_VERIFY_MS = 3_500
const WINDOWS_DESCENDANT_POLL_MS = 100

/**
 * A Windows descendant tree captured while its root was alive, with the
 * PID-reuse guard the POSIX snapshot gets from ps lstart: a row only counts as
 * the same process when its creation time still matches. Rows without a
 * creation time are never signalled, because a bare pid cannot be re-identified,
 * but they are counted: a descendant that was seen and denied identification
 * is one no later read can prove gone.
 */
export type WindowsProcessIdentity = { pid: number; creationTimeMs: number }

export type WindowsDescendantSnapshot = {
  root: WindowsProcessIdentity
  descendants: WindowsProcessIdentity[]
  /** Descendants seen in the walk that denied the creation-time query. */
  unidentifiedCount: number
  capturedAtMs: number
  /** Per-PID boundaries retained when close refreshes merge snapshots. */
  capturedAtMsByPid?: Readonly<Record<string, number>>
}

export type WindowsDescendantVerificationDeps = {
  readTable?: () => Promise<{ pid: number; ppid: number; creationTimeMs?: number }[]>
  now?: () => number
  wait?: (ms: number) => Promise<void>
  verifyMs?: number
}

/** Revalidate a Windows PID/creation-time identity immediately before a kill. */
export async function verifyWindowsProcessIdentity(
  target: WindowsProcessIdentity,
  deps: Pick<WindowsDescendantVerificationDeps, 'readTable'> = {}
): Promise<boolean> {
  if (
    !Number.isSafeInteger(target.pid) ||
    target.pid <= 0 ||
    target.pid > 0xffffffff ||
    target.pid === process.pid ||
    !Number.isSafeInteger(target.creationTimeMs) ||
    target.creationTimeMs <= 0
  ) {
    return false
  }
  const table = await (deps.readTable ?? readWindowsProcessTableFresh)().catch(() => null)
  const current = table?.filter((row) => row.pid === target.pid) ?? []
  return current.length === 1 && current[0]?.creationTimeMs === target.creationTimeMs
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

/**
 * Snapshot a Windows root's descendants while it is still alive. Resolves null
 * (never rejects) when the table is unreadable or the root is absent — the same
 * contract as the POSIX walk, because "cannot see" is never "nothing is there".
 *
 * Stale parent links are pruned by creation time, so a backwards clock step
 * between two spawns can drop a live descendant — accepted over a certain stall.
 */
export async function captureWindowsDescendantSnapshot(
  rootPid: number,
  deps: WindowsDescendantVerificationDeps = {}
): Promise<WindowsDescendantSnapshot | null> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return null
  }
  const capturedAtMs = (deps.now ?? Date.now)()
  // One table read, not a walk plus an identity read: each is bounded in
  // seconds, and this runs inside the close ladder's budget.
  const table = await (deps.readTable ?? readWindowsProcessTableFresh)().catch(() => null)
  if (!table) {
    return null
  }
  // One index for both lookups, so a repeated pid resolves to the same row for
  // the root and for a parent link: `byPid` is first-wins, a Map is not.
  const rowsByPid = getProcessTableIndex(table).byPid
  const root = rowsByPid.get(rootPid)
  if (typeof root?.creationTimeMs !== 'number') {
    return null
  }
  const rootCreationTimeMs = root.creationTimeMs
  // Windows keeps a process's original parent PID after that parent exits, so a
  // reused PID is not ancestry: no real child predates the parent it claims.
  // The root's start backstops the undefined-time bypass, which admits a row
  // unchecked and leaves its children no parent time to compare against. Ties
  // pass -- FILETIMEs truncated to ms make a same-millisecond parent and child
  // collide exactly, so `>` would drop true descendants.
  const currentRows = table.filter((row) => {
    const parentCreationTimeMs = rowsByPid.get(row.ppid)?.creationTimeMs
    return (
      // Its own ppid can be recycled too, and a pruned root loses the snapshot.
      row.pid === rootPid ||
      row.creationTimeMs === undefined ||
      (row.creationTimeMs >= rootCreationTimeMs &&
        (parentCreationTimeMs === undefined || row.creationTimeMs >= parentCreationTimeMs))
    )
  })
  const descendants = collectDescendantsFromIndex(getProcessTableIndex(currentRows), rootPid).sort(
    (left, right) => right.depth - left.depth
  )
  if (!descendants) {
    return null
  }
  return {
    root: { pid: root.pid, creationTimeMs: root.creationTimeMs },
    descendants: descendants.flatMap((row) =>
      // A descendant that denied a creation-time query cannot be told from a
      // recycled pid later, so it is never signalled on a bare pid.
      typeof row.creationTimeMs === 'number'
        ? [{ pid: row.pid, creationTimeMs: row.creationTimeMs }]
        : []
    ),
    unidentifiedCount: descendants.filter((row) => typeof row.creationTimeMs !== 'number').length,
    capturedAtMs
  }
}

export type IdentifiedWindowsProcessTerminationDeps = {
  readTable?: WindowsDescendantVerificationDeps['readTable']
  requestTermination?: (target: WindowsProcessIdentity) => Promise<'requested' | 'unavailable'>
  ownsRoot?: () => boolean
}

/** The fresh table admits a captured identity; the native owner rechecks its birth on the signal HANDLE. */
export async function requestIdentifiedWindowsProcessTermination(
  target: WindowsProcessIdentity,
  deps: IdentifiedWindowsProcessTerminationDeps = {}
): Promise<boolean> {
  if (!(await verifyWindowsProcessIdentity(target, { readTable: deps.readTable }))) {
    return false
  }
  if (deps.ownsRoot?.() === false) {
    return false
  }
  const outcome = deps.requestTermination
    ? await deps.requestTermination(target)
    : requestWindowsProcessTermination(target.pid, target.creationTimeMs)
  return outcome === 'requested'
}

/** Stop only children retained from a live owned root; root exit never authorizes a new walk. */
export async function terminateWindowsDescendantSnapshot(
  snapshot: WindowsDescendantSnapshot,
  deps: WindowsDescendantVerificationDeps & {
    requestTermination?: IdentifiedWindowsProcessTerminationDeps['requestTermination']
  } = {}
): Promise<DescendantTreeVerdict> {
  await Promise.all(
    snapshot.descendants
      .filter(
        (target) =>
          target.pid !== snapshot.root.pid &&
          Number.isFinite(target.creationTimeMs) &&
          target.creationTimeMs >= snapshot.root.creationTimeMs
      )
      .map((target) =>
        requestIdentifiedWindowsProcessTermination(target, {
          readTable: deps.readTable,
          requestTermination: deps.requestTermination
        })
      )
  )
  return verifyWindowsDescendantSnapshotExit(snapshot, deps)
}

/**
 * Whether a snapshotted Windows tree is gone, polled to a bounded deadline.
 *
 * A native termination request does not prove exit. Only a fresh table read
 * that no longer shows an identity-matched row does.
 */
export async function verifyWindowsDescendantSnapshotExit(
  snapshot: WindowsDescendantSnapshot,
  deps: WindowsDescendantVerificationDeps = {}
): Promise<DescendantTreeVerdict> {
  // The most a read can prove: a descendant that denied identification was seen
  // and can never be matched gone, so "could not look" caps the verdict.
  const proven: DescendantTreeVerdict = snapshot.unidentifiedCount > 0 ? 'unverifiable' : 'exited'
  if (snapshot.descendants.length === 0) {
    return proven
  }
  const now = deps.now ?? Date.now
  const readTable = deps.readTable ?? readWindowsProcessTableFresh
  const deadline = now() + (deps.verifyMs ?? WINDOWS_DESCENDANT_KILL_VERIFY_MS)
  let verdict: DescendantTreeVerdict = 'unverifiable'
  do {
    const table = await readTable().catch(() => null)
    if (!table) {
      verdict = 'unverifiable'
    } else {
      const live = new Map<number, number | undefined | null>()
      for (const row of table) {
        live.set(row.pid, live.has(row.pid) ? null : row.creationTimeMs)
      }
      const unidentified = snapshot.descendants.some(
        (row) => live.has(row.pid) && !Number.isFinite(live.get(row.pid))
      )
      verdict = snapshot.descendants.some((row) => live.get(row.pid) === row.creationTimeMs)
        ? 'live'
        : unidentified
          ? 'unverifiable'
          : proven
      if (verdict === proven) {
        return verdict
      }
    }
    if (now() >= deadline) {
      return verdict
    }
    await (deps.wait ?? delay)(WINDOWS_DESCENDANT_POLL_MS)
  } while (now() < deadline)
  return verdict
}
