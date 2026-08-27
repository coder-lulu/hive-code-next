import { app } from 'electron'
import type { UpdateStatus } from '../shared/update-status-types'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'

const MAC_INSTALL_READY_TIMEOUT_MS = 15000

/** Epoch that binds macOS installer readiness to a specific download cycle. */
let macDownloadGeneration = 0

/** Whether Squirrel.Mac has finished downloading the update from the localhost proxy. */
let squirrelReady = false
/** Remembers a user/app quit request that arrived before Squirrel.Mac had a
 * staged update ready to apply. Without this handoff, quitting during the
 * localhost-proxy phase exits back into the old app and the update is lost. */
let installRequestedAfterSquirrelReady = false
/** Prevents the updater-specific before-quit guard from re-blocking the
 * quitAndInstall-triggered shutdown that is supposed to apply the update. */
let quitAndInstallInFlight = false
/** Lets a timed-out quit attempt proceed exactly once so the app never gets
 * trapped open if Squirrel.Mac stops short of the native ready signal. */
let bypassMacInstallGuardOnce = false
let pendingInstallTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Electron's native macOS updater emits no version/request identity. Consequently only one physical
 * download generation can ever be authorized in a process: after reset, overlap, or an unexpected
 * extra native signal, no later signal can be proven to belong to the current package.
 */
let macNativeReadyLifetimeGeneration: number | null = null
let pendingMacNativeReadyGeneration: number | null = null
let macNativeReadyPoisoned = false

function clearPendingInstallTimeout(): void {
  if (pendingInstallTimeout) {
    clearTimeout(pendingInstallTimeout)
    pendingInstallTimeout = null
  }
}

export function resetMacInstallState(): void {
  if (macNativeReadyLifetimeGeneration !== null) {
    poisonMacNativeReadiness('state-reset-after-physical-download')
  }
  macDownloadGeneration += 1
  squirrelReady = false
  installRequestedAfterSquirrelReady = false
  quitAndInstallInFlight = false
  bypassMacInstallGuardOnce = false
  clearPendingInstallTimeout()
}

export function beginMacUpdateDownload(): void {
  resetMacInstallState()
}

export function getMacDownloadGeneration(): number {
  return macDownloadGeneration
}

function poisonMacNativeReadiness(reason: string): void {
  if (macNativeReadyPoisoned) {
    return
  }
  macNativeReadyPoisoned = true
  pendingMacNativeReadyGeneration = null
  squirrelReady = false
  recordUpdaterLifecycle(
    'macos_native_ready_poisoned',
    { reason, currentGeneration: macDownloadGeneration },
    {
      level: 'warn',
      message: 'macOS native updater readiness became ambiguous; restart required before retrying'
    }
  )
}

export function captureMacDownloadGenerationForNativeReady(): number {
  if (macNativeReadyPoisoned) {
    return macDownloadGeneration
  }
  if (macNativeReadyLifetimeGeneration === null) {
    macNativeReadyLifetimeGeneration = macDownloadGeneration
    pendingMacNativeReadyGeneration = macDownloadGeneration
    return macDownloadGeneration
  }
  if (macNativeReadyLifetimeGeneration !== macDownloadGeneration) {
    poisonMacNativeReadiness('multiple-physical-download-generations')
  }
  return macDownloadGeneration
}

export function consumePendingMacNativeReadyGeneration(): number | null {
  if (macNativeReadyPoisoned) {
    return null
  }
  if (pendingMacNativeReadyGeneration === null) {
    poisonMacNativeReadiness('unexpected-or-duplicate-native-ready')
    return null
  }
  const generation = pendingMacNativeReadyGeneration
  pendingMacNativeReadyGeneration = null
  return generation
}

export function markMacQuitAndInstallInFlight(): void {
  installRequestedAfterSquirrelReady = false
  quitAndInstallInFlight = true
  bypassMacInstallGuardOnce = false
  clearPendingInstallTimeout()
}

export function consumeMacInstallGuardBypass(): boolean {
  if (!bypassMacInstallGuardOnce) {
    return false
  }
  bypassMacInstallGuardOnce = false
  return true
}

export function isMacQuitAndInstallInFlight(): boolean {
  return quitAndInstallInFlight
}

export function isMacInstallerReady(): boolean {
  return squirrelReady && !macNativeReadyPoisoned
}

export function hasMacInstallAuthority(): boolean {
  return process.platform !== 'darwin' || isMacInstallerReady()
}

export function isWaitingForMacInstallerReadiness(
  currentStatus: UpdateStatus,
  hasNewerDownloadedVersion: boolean
): boolean {
  if (
    process.platform !== 'darwin' ||
    squirrelReady ||
    macNativeReadyPoisoned ||
    !hasNewerDownloadedVersion
  ) {
    return false
  }

  // electron-updater fires 'update-downloaded' before Squirrel.Mac has staged
  // the update. Once we show 100% downloaded, treat quits as "install this as
  // soon as ShipIt is ready" instead of exiting back into the old version.
  return currentStatus.state === 'downloading' && currentStatus.percent === 100
}

export function deferMacQuitUntilInstallerReady(
  currentStatus: UpdateStatus,
  hasNewerDownloadedVersion: boolean,
  getPendingInstallVersion: () => string,
  sendStatus: (status: UpdateStatus) => void
): boolean {
  if (!isWaitingForMacInstallerReadiness(currentStatus, hasNewerDownloadedVersion)) {
    return false
  }

  installRequestedAfterSquirrelReady = true
  sendStatus({ state: 'downloading', percent: 100, version: getPendingInstallVersion() })

  if (pendingInstallTimeout) {
    return true
  }

  pendingInstallTimeout = setTimeout(() => {
    pendingInstallTimeout = null
    if (!installRequestedAfterSquirrelReady || quitAndInstallInFlight) {
      return
    }

    recordUpdaterLifecycle(
      'macos_install_guard_timeout',
      { timeoutMs: MAC_INSTALL_READY_TIMEOUT_MS },
      {
        level: 'warn',
        message: `macOS installer was not ready after ${MAC_INSTALL_READY_TIMEOUT_MS}ms; allowing quit without install`
      }
    )
    installRequestedAfterSquirrelReady = false
    // This is a safety valve. The updater path should wait for ShipIt so the
    // staged update can apply, but if the native ready signal never arrives we
    // must let the app close instead of trapping the user in a blocked quit.
    bypassMacInstallGuardOnce = true
    app.quit()
  }, MAC_INSTALL_READY_TIMEOUT_MS)

  return true
}

export function handleMacInstallerReady(
  generation: number,
  hasNewerDownloadedVersion: boolean,
  onReadyToInstall: () => void | Promise<void>,
  onReadyToReportDownloaded: () => void
): void {
  // Why: a late native-ready signal from an older download cycle must not arm
  // install for a different candidate that replaced it.
  if (macNativeReadyPoisoned || generation !== macDownloadGeneration) {
    recordUpdaterLifecycle('macos_installer_ready_ignored', {
      reason: macNativeReadyPoisoned ? 'ambiguous-native-ready' : 'stale-generation',
      eventGeneration: generation,
      currentGeneration: macDownloadGeneration,
      hasNewerDownloadedVersion
    })
    return
  }
  squirrelReady = true
  clearPendingInstallTimeout()
  recordUpdaterLifecycle('macos_installer_ready', {
    deferredInstallRequested: installRequestedAfterSquirrelReady,
    hasNewerDownloadedVersion,
    generation
  })

  if (installRequestedAfterSquirrelReady && hasNewerDownloadedVersion) {
    onReadyToReportDownloaded()
    void Promise.resolve()
      .then(() => onReadyToInstall())
      .catch((error) => {
        recordUpdaterLifecycle(
          'macos_deferred_install_handoff_failed',
          { errorType: error instanceof Error ? error.name : typeof error },
          { level: 'warn', message: 'Deferred macOS install handoff failed' }
        )
      })
    return
  }

  if (hasNewerDownloadedVersion) {
    onReadyToReportDownloaded()
  }
}
