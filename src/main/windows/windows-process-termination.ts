import { admitSelfInitiatedTreeKill } from '../own-chromium-tree-kill-guard'
import type { WindowsProcessTreeModule } from './windows-process-tree-native-contract'

/** The caller supplies the sole loader; an unavailable request never falls back to a PID signal. */
export function requestNativeWindowsProcessTermination(
  pid: number,
  creationTimeMs: number,
  loadNative: () => WindowsProcessTreeModule | null
): 'requested' | 'unavailable' {
  if (
    process.platform !== 'win32' ||
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    pid > 0xffffffff ||
    pid === process.pid ||
    !Number.isSafeInteger(creationTimeMs) ||
    creationTimeMs <= 0
  ) {
    return 'unavailable'
  }
  try {
    const native = loadNative()
    if (typeof native?.terminateProcessIfCreationTimeMatches !== 'function') {
      return 'unavailable'
    }
    if (
      !admitSelfInitiatedTreeKill({
        pid,
        site: 'windows-identified-process',
        scope: 'win-identified-process'
      })
    ) {
      return 'unavailable'
    }
    return native.terminateProcessIfCreationTimeMatches(pid, creationTimeMs) === true
      ? 'requested'
      : 'unavailable'
  } catch {
    return 'unavailable'
  }
}
