import { parse } from 'yaml'
import * as productUpdateSourceModule from '../../shared/product-update-source'
import {
  resolveProductUpdateFeedUrl,
  resolveProductUpdateSource
} from '../../shared/product-update-source'
import { isProductVersion } from '../../shared/product-version'
import { cancelUnreadResponseBody } from '../lib/unread-response-body'
import {
  cacheMandatoryHiveCloudDecision,
  readCachedMandatoryHiveCloudDecision
} from '../product/hivecloud-update-cache'
import { fetchHiveCloudUpdateDecision } from '../product/hivecloud-update-check'
import { validateHiveCloudUpdateManifest } from '../product/hivecloud-update-manifest'
import { fetchWithProductUpdaterSession } from '../product/product-updater-session'
import { getDesktopReleaseIdentity } from '../product/release-identity'
import { readResponseTextWithLimit } from '../updater-response-body'
import { UpdaterInstallExecution } from './updater-install-execution'
import type { ReleaseFeedPreflightResult } from './updater-state'
import { ReleaseFeedPreflightError } from './updater-state'
import type { UpdateCheckVariant } from './updater-types'

const MAX_GENERIC_UPDATE_MANIFEST_BYTES = 256 * 1024
const GENERIC_UPDATE_PREFLIGHT_TIMEOUT_MS = 5000

export abstract class UpdaterProductFeed extends UpdaterInstallExecution {
  protected async prepareHiveCloudReleaseFeed(
    variant: UpdateCheckVariant,
    attemptId: number
  ): Promise<ReleaseFeedPreflightResult> {
    const source = resolveProductUpdateSource()
    if (source?.provider !== 'hivecloud' || source.github !== null) {
      throw new Error('HiveCloud update source is not configured')
    }
    const feedUrl = resolveProductUpdateFeedUrl(source, process.platform, process.arch)
    if (!feedUrl) {
      throw new Error('HiveCloud updates are unavailable for this platform')
    }
    if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
      return 'superseded'
    }
    const checkSourceResolver = Object.hasOwn(
      productUpdateSourceModule,
      'resolveProductUpdateCheckSource'
    )
      ? productUpdateSourceModule.resolveProductUpdateCheckSource
      : undefined
    const checkSource = checkSourceResolver?.()
    if (typeof checkSourceResolver === 'function' && !checkSource) {
      throw new ReleaseFeedPreflightError(
        'feed-unavailable',
        variant,
        'HiveCloud update check endpoint is not configured'
      )
    }
    if (checkSourceResolver && checkSource) {
      const identity = getDesktopReleaseIdentity()
      try {
        const decision = await fetchHiveCloudUpdateDecision({
          endpoint: checkSource.endpoint,
          product: identity.product,
          platform: identity.platform,
          architecture: identity.architecture,
          channel: checkSource.channel,
          currentVersion: identity.versionName,
          currentBuild: identity.buildNumber,
          fetchImpl: fetchWithProductUpdaterSession,
          timeoutMs: GENERIC_UPDATE_PREFLIGHT_TIMEOUT_MS
        })
        if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
          return 'superseded'
        }
        this.pendingHiveCloudDecision = decision
        this.activeHiveCloudDecision = decision
        cacheMandatoryHiveCloudDecision(decision)
      } catch (error) {
        if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
          return 'superseded'
        }
        const cachedMandatory = readCachedMandatoryHiveCloudDecision(
          getDesktopReleaseIdentity().buildNumber
        )
        this.pendingHiveCloudDecision = cachedMandatory
        this.activeHiveCloudDecision = cachedMandatory
        throw new ReleaseFeedPreflightError(
          'feed-unavailable',
          variant,
          cachedMandatory
            ? 'HiveCloud is unavailable and a cached mandatory update still applies.'
            : String(error instanceof Error ? error.message : error)
        )
      }
      if (!this.pendingHiveCloudDecision.hasUpdate) {
        return 'not-available'
      }
    }
    this.advanceUpdateAuthorityEpoch()
    this.activeReleaseFeedUrl = feedUrl
    this.getAutoUpdater().setFeedURL({ provider: 'generic', url: feedUrl })
    const manifestUrl = new URL(this.getGenericUpdateManifestName(), feedUrl).href
    const response = await fetchWithProductUpdaterSession(manifestUrl, {
      redirect: 'error',
      signal: AbortSignal.timeout(GENERIC_UPDATE_PREFLIGHT_TIMEOUT_MS)
    })
    if (!response.ok) {
      await cancelUnreadResponseBody(response)
      throw new ReleaseFeedPreflightError(
        'manifest-unavailable',
        variant,
        'Unable to resolve the HiveCloud update feed'
      )
    }
    const manifestText = await readResponseTextWithLimit(
      response,
      MAX_GENERIC_UPDATE_MANIFEST_BYTES
    )
    if (manifestText === null) {
      throw new ReleaseFeedPreflightError(
        'manifest-unavailable',
        variant,
        'HiveCloud update metadata exceeded the size limit'
      )
    }
    let manifest: unknown
    try {
      manifest = parse(manifestText)
    } catch {
      manifest = null
    }
    const version = (
      manifest as {
        version?: unknown
      } | null
    )?.version
    if (typeof version !== 'string' || !isProductVersion(version)) {
      throw new ReleaseFeedPreflightError(
        'manifest-unavailable',
        variant,
        'HiveCloud update metadata did not contain a valid version'
      )
    }
    if (
      this.pendingHiveCloudDecision?.latest &&
      version !== this.pendingHiveCloudDecision.latest.versionName
    ) {
      throw new ReleaseFeedPreflightError(
        'manifest-unavailable',
        variant,
        'HiveCloud update metadata does not match the control-plane release'
      )
    }
    if (this.pendingHiveCloudDecision?.hasUpdate) {
      const latest = this.pendingHiveCloudDecision.latest
      const artifact = latest?.artifact ?? this.pendingHiveCloudDecision.artifact
      if (!latest || !artifact) {
        throw new ReleaseFeedPreflightError(
          'manifest-unavailable',
          variant,
          'HiveCloud update metadata is missing the control-plane artifact'
        )
      }
      try {
        validateHiveCloudUpdateManifest(manifest, {
          versionName: latest.versionName,
          artifact
        })
      } catch (error) {
        throw new ReleaseFeedPreflightError(
          'manifest-unavailable',
          variant,
          error instanceof Error ? error.message : 'HiveCloud update metadata is invalid'
        )
      }
    }
    if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
      return 'superseded'
    }
    this.setExpectedUpdateOffer({
      generation: attemptId,
      authorityEpoch: this.updateAuthorityEpoch,
      kind: 'release',
      provider: 'hivecloud',
      source: 'release',
      repository: null,
      sourceChannel: source.channel,
      checkChannel: variant,
      tag: version,
      version,
      feedUrl,
      overrideChannel: this.getReleaseChannelOverride?.() ?? null
    })
    return 'ready'
  }

  protected getGenericUpdateManifestName(): string {
    if (process.platform === 'darwin') {
      return 'latest-mac.yml'
    }
    if (process.platform === 'linux') {
      return 'latest-linux.yml'
    }
    return 'latest.yml'
  }

  protected commitReleaseFeedForAttempt(
    attemptId: number,
    url: string,
    tag: string,
    variant: UpdateCheckVariant
  ): boolean {
    if (!this.canCommitReleaseFeedForAttempt(attemptId)) {
      return false
    }
    const source = resolveProductUpdateSource()
    if (!source?.github) {
      return false
    }
    this.advanceUpdateAuthorityEpoch()
    this.activeReleaseFeedUrl = url
    this.getAutoUpdater().setFeedURL({ provider: 'generic', url })
    this.setExpectedUpdateOffer({
      generation: attemptId,
      authorityEpoch: this.updateAuthorityEpoch,
      kind: 'release',
      provider: 'github',
      source: 'release',
      repository: source.github.repo,
      sourceChannel: source.channel,
      checkChannel: variant,
      tag,
      version: tag.replace(/^v/, ''),
      feedUrl: url,
      overrideChannel: this.getReleaseChannelOverride?.() ?? null
    })
    return true
  }

  protected canCommitReleaseFeedForAttempt(attemptId: number): boolean {
    return (
      this.isActiveUpdateCheckAttempt(attemptId) &&
      this.activeUpdateSource === 'release' &&
      !this.isPinnedBuildActive &&
      !this.localBuildSelectionInProgress &&
      !this.pinnedBuildSelectionInProgress
    )
  }
}
