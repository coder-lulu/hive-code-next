import type { UpdateStatus } from '../shared/update-status-types'
import type { ElectronAutoUpdater } from './electron-updater-loader'

export const AUTO_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
export const AUTO_UPDATE_RETRY_INTERVAL_MS = 60 * 60 * 1000

export type UpdaterHandlerContext = {
  autoUpdater: ElectronAutoUpdater
  clearBackgroundCheckLaunchPending: () => void
  clearAvailableUpdateContext: () => void
  consumeMissingManifestPrereleaseFallbackResult: () => { userInitiated: boolean } | null
  getPublishingWindowLastGoodCheck: () => { lastGoodTag: string } | null
  getMissingManifestPrereleaseFallbackUserInitiated: () => boolean | null
  getCurrentStatus: () => UpdateStatus
  getActiveUpdateCheckEventAttemptId: () => number | null
  getKnownReleaseUrl: () => string | undefined
  getPendingInstallVersion: () => string
  getUserInitiatedCheck: () => boolean
  handleQuitAndInstallFailure: (error?: unknown) => boolean
  isQuitAndInstallHandoffActive: () => boolean
  hasInstallableDownloadedVersion: () => boolean
  isLocalBuildCheck: () => boolean
  isPinnedBuildCheck: () => boolean
  isExpectedUpdateOffer: (attemptId: number, version: string) => boolean
  rejectUnexpectedUpdateOffer: (
    attemptId: number,
    version: string,
    wasUserInitiated: boolean
  ) => void
  acceptDownloadedUpdateCandidate: (version: string) => boolean
  shouldHandleUpdaterErrorEvent: () => boolean
  clearUpdateAvailableEventPending: (attemptId: number | null) => void
  isActiveUpdateCheckAttempt: (attemptId: number) => boolean
  markUpdateCheckEventAttempt: () => boolean
  markUpdateAvailableEventPending: (attemptId: number | null) => void
  markMissingManifestPrereleaseFallbackChecking: () => void
  performQuitAndInstall: () => void | Promise<void>
  shouldDeferMacQuitForInstall: () => boolean
  recordCompletedUpdateCheck: () => void
  restoreReleaseUpdateSource: () => void
  sendCheckFailureStatus: (
    message: string,
    userInitiated?: boolean,
    source?: 'event' | 'promise' | 'fallback-promise',
    sourceError?: unknown
  ) => Promise<void>
  sendErrorStatus: (message: string, userInitiated?: boolean) => void
  sendStatus: (status: UpdateStatus) => void
  scheduleAutomaticUpdateCheck: (delayMs: number) => void
  shouldSuppressMissingManifestPrereleaseFallbackEvent: (message: string, error: unknown) => boolean
  suppressMissingManifestPrereleaseFallbackPromiseFailure: (message: string) => void
  setAvailableReleaseUrl: (releaseUrl: string | null) => void
  setAvailableVersion: (version: string | null) => void
  setUserInitiatedCheck: (value: boolean) => void
}
