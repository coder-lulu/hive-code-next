import type {
  WindowsDescendantSnapshot,
  WindowsProcessIdentity
} from '../windows-descendant-exit-verification'
import type { SpawnedProcess } from '../../shared/child-process/run-process'

type RootTerminationInput = {
  child: Pick<SpawnedProcess, 'kill'>
  exited: () => boolean
}

/**
 * Kills the root through the handle Node owns rather than through its pid, which
 * is why no identity probe gates it: libuv drops that handle in the same turn it
 * reaps, so the signal either reaches the process Orca spawned or reaches
 * nothing. A probe here could only let an unreadable process table cost the tree
 * the one fallback that still works once every table read has failed.
 *
 * On POSIX the root is the provider supervisor, killed only after its own stop had
 * its whole bound; Claude, in its own group, is reached by the descendant kill.
 *
 * False means no signal was sent, because the root had already left.
 */
export function terminateClaudeRoot(input: RootTerminationInput): boolean {
  return input.exited() ? false : input.child.kill('SIGKILL')
}

type WindowsRootTerminationInput = {
  snapshot: WindowsDescendantSnapshot | null
  exited: () => boolean
  verifyRoot: (root: WindowsProcessIdentity) => Promise<boolean>
  terminateTree: (root: WindowsProcessIdentity) => Promise<void>
  killRoot: () => boolean
}

/**
 * Captured identity gates the root request; the native owner checks birth on its signal HANDLE.
 * The original Node-owned handle fallback runs regardless of the probe result.
 */
export async function terminateClaudeWindowsRoot(
  input: WindowsRootTerminationInput
): Promise<{ rootVerified: boolean }> {
  const { snapshot, exited, verifyRoot, terminateTree, killRoot } = input
  let rootVerified = false
  if (!exited() && snapshot) {
    rootVerified = await verifyRoot(snapshot.root).catch(() => false)
    if (rootVerified && !exited()) {
      await terminateTree(snapshot.root).catch(() => {})
    }
  }
  killRoot()
  return { rootVerified }
}
