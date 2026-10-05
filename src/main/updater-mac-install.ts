import { app, autoUpdater as nativeUpdater } from 'electron'
import type { UpdateStatus, UpdateStatusMetadata } from '../shared/update-status-types'
import { recordUpdaterLifecycle } from './updater-lifecycle-diagnostics'

const MAC_INSTALL_READY_TIMEOUT_MS = 15000

/** Epoch that binds macOS installer readiness to a specific download cycle. */
let macDownloadGeneration = 0

export function registerMacUpdaterEvents({
  getCurrentStatus,
  hasInstallableDownloadedVersion,
  getPendingInstallVersion,
  getKnownReleaseUrl,
  performQuitAndInstall,
  shouldDeferMacQuitForInstall,
  sendStatus,
  getUpdateMetadata
}: {
  getCurrentStatus: () => UpdateStatus
  hasInstallableDownloadedVersion: () => boolean
  getPendingInstallVersion: () => string
  getKnownReleaseUrl: () => string | undefined
  performQuitAndInstall: () => void | Promise<void>
  shouldDeferMacQuitForInstall: () => boolean
  sendStatus: (status: UpdateStatus) => void
  getUpdateMetadata: () => UpdateStatusMetadata
}): void {
  if (process.platform === 'darwin') {
    nativeUpdater.on('update-downloaded', () => {
      const generation = consumePendingMacNativeReadyGeneration()
      if (generation === null) {
        return
      }
      const hasInstallableVersion = hasInstallableDownloadedVersion()
      handleMacInstallerReady(generation, hasInstallableVersion, performQuitAndInstall, () => {
        sendStatus({
          state: 'downloaded',
          version: getPendingInstallVersion(),
          releaseUrl: getKnownReleaseUrl(),
          ...getUpdateMetadata()
        })
      })
    })
  }

  // Why: veto before startup listeners begin shutting down services.
  app.prependListener('before-quit', (event) => {
    if (!shouldDeferMacQuitForInstall()) {
      return
    }
    // Why: an Update & Restart is checking blockers or cleaning up; a second quit must not tear down underneath it.
    if (macInstallPreflightInProgress) {
      event.preventDefault()
      return
    }
    if (shouldBypassMacInstallGuard()) {
      recordUpdaterLifecycle('macos_before_quit_guard_bypassed')
      return
    }
    if (isMacQuitAndInstallInFlight()) {
      return
    }
    if (
      deferMacQuitUntilInstallerReady(
        getCurrentStatus(),
        hasInstallableDownloadedVersion(),
        getPendingInstallVersion,
        sendStatus,
        'quit'
      )
    ) {
      recordUpdaterLifecycle('macos_before_quit_deferred', {
        version: getPendingInstallVersion()
      })
      event.preventDefault()
    }
  })
}

/** Whether Squirrel.Mac has finished downloading the update from the localhost proxy. */
let squirrelReady = false
let macInstallPreflightInProgress = false

export function setMacInstallPreflightInProgress(value: boolean): void {
  macInstallPreflightInProgress = value
  if (value) {
    bypassMacInstallGuardUntilNextAttempt = false
  }
}
/** Remembers a user/app quit request that arrived before Squirrel.Mac had a
 * staged update ready to apply. Without this handoff, quitting during the
 * localhost-proxy phase exits back into the old app and the update is lost. */
let requestedActionAfterSquirrelReady: 'quit' | 'install' | null = null
/** Prevents the updater-specific before-quit guard from re-blocking the
 * quitAndInstall-triggered shutdown that is supposed to apply the update. */
let quitAndInstallInFlight = false
/** Both quit passes must proceed when native readiness times out. */
let bypassMacInstallGuardUntilNextAttempt = false
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
  macInstallPreflightInProgress = false
  requestedActionAfterSquirrelReady = null
  quitAndInstallInFlight = false
  bypassMacInstallGuardUntilNextAttempt = false
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
  requestedActionAfterSquirrelReady = null
  quitAndInstallInFlight = true
  bypassMacInstallGuardUntilNextAttempt = false
  clearPendingInstallTimeout()
}

function shouldBypassMacInstallGuard(): boolean {
  return bypassMacInstallGuardUntilNextAttempt
}

export function isMacInstallRequested(): boolean {
  return requestedActionAfterSquirrelReady === 'install'
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
  sendStatus: (status: UpdateStatus) => void,
  intent: 'quit' | 'install' = 'install'
): boolean {
  if (!isWaitingForMacInstallerReadiness(currentStatus, hasNewerDownloadedVersion)) {
    return false
  }

  if (intent === 'install') {
    bypassMacInstallGuardUntilNextAttempt = false
  }
  // Why: an ordinary retry of quit must not downgrade a pending Update & Restart.
  if (intent === 'install' || requestedActionAfterSquirrelReady !== 'install') {
    requestedActionAfterSquirrelReady = intent
  }
  sendStatus({ state: 'downloading', percent: 100, version: getPendingInstallVersion() })

  if (pendingInstallTimeout) {
    return true
  }

  pendingInstallTimeout = setTimeout(() => {
    pendingInstallTimeout = null
    if (!requestedActionAfterSquirrelReady || quitAndInstallInFlight) {
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
    requestedActionAfterSquirrelReady = null
    // This is a safety valve. The updater path should wait for ShipIt so the
    // staged update can apply, but if the native ready signal never arrives we
    // must let the app close instead of trapping the user in a blocked quit.
    bypassMacInstallGuardUntilNextAttempt = true
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
    deferredInstallRequested: requestedActionAfterSquirrelReady === 'install',
    deferredQuitRequested: requestedActionAfterSquirrelReady === 'quit',
    hasNewerDownloadedVersion
  })

  if (requestedActionAfterSquirrelReady === 'quit') {
    requestedActionAfterSquirrelReady = null
    app.quit()
    return
  }

  if (requestedActionAfterSquirrelReady === 'install' && hasNewerDownloadedVersion) {
    // Publish readiness before the deferred action rechecks the exact downloaded candidate.
    onReadyToReportDownloaded()
    setMacInstallPreflightInProgress(true)
    void Promise.resolve()
      .then(() => onReadyToInstall())
      .catch((error) => {
        requestedActionAfterSquirrelReady = null
        setMacInstallPreflightInProgress(false)
        recordUpdaterLifecycle(
          'macos_deferred_install_handoff_failed',
          { errorType: error instanceof Error ? error.name : typeof error },
          { level: 'warn', message: 'Deferred macOS install handoff failed' }
        )
      })
    return
  }

  requestedActionAfterSquirrelReady = null
  if (hasNewerDownloadedVersion) {
    onReadyToReportDownloaded()
  }
}
