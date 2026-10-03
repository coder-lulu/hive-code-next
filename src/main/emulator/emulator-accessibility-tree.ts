import { EmulatorError } from './emulator-errors'
import type { EmulatorSessionRegistry } from './emulator-session-registry'
import { deriveAxUrlFromStreamUrl } from './serve-sim-detached-session'
import type { EmulatorBackend, EmulatorTargetOpts } from './backends/emulator-backend'

export async function readEmulatorAccessibilityTree(
  sessionRegistry: EmulatorSessionRegistry,
  backend: EmulatorBackend,
  device: string,
  opts?: EmulatorTargetOpts
): Promise<unknown> {
  if (backend.kind !== 'ios') {
    return backend.accessibilityTree!(device)
  }
  const udid = await backend.resolveDeviceId(device)
  const worktreeId = opts?.worktreeId
  // Explicit device reads fall back to the udid-keyed session when the worktree has no active one.
  const session =
    (worktreeId ? sessionRegistry.getActiveForWorktree(worktreeId) : null) ??
    sessionRegistry.getSession(udid)
  if (worktreeId && session && session.deviceUdid !== udid) {
    throw new EmulatorError(
      'emulator_no_active',
      `iOS simulator ${udid} is not active for this worktree (active: ${session.deviceUdid}); attach the requested simulator first.`
    )
  }
  // Older detached sessions may need their accessibility endpoint derived from the stream URL.
  const axUrl = session?.axUrl ?? deriveAxUrlFromStreamUrl(session?.streamUrl)
  return backend.accessibilityTree!(udid, axUrl)
}
