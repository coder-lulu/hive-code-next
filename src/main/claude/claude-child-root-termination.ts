import type {
  WindowsDescendantSnapshot,
  WindowsProcessIdentity
} from '../windows-descendant-exit-verification'
import type { SpawnedProcess } from '@orca/process-host/process-spec'

type RootTerminationInput = {
  child: Pick<SpawnedProcess, 'kill'>
  exited: () => boolean
}

/** Use Node's retained handle so unreadable tables cannot block root termination or target a recycled PID. */
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
