import { session } from 'electron'
import { installProductUpdaterHttpExecutorBoundary } from './product-updater-http-executor-boundary'
import type { ProductUpdaterHttpExecutor } from './product-updater-http-executor-types'
import {
  getBoundedArtifactContentLength,
  isAllowedProductUpdaterRequest,
  isAllowedProductUpdaterRedirectTarget,
  isFinalUpdaterArtifactUrl,
  isFinalUpdaterRedirectArtifactUrl,
  type ProductUpdaterNetworkMode
} from './product-updater-network-policy'

export { installProductUpdaterHttpExecutorBoundary } from './product-updater-http-executor-boundary'
export type { ProductUpdaterHttpExecutor } from './product-updater-http-executor-types'
export {
  isAllowedProductUpdaterRequest,
  isAllowedProductUpdaterRedirectTarget,
  type ProductUpdaterNetworkMode
} from './product-updater-network-policy'
export { isBoundedUpdaterArtifactSize } from '../updater-artifact-size-policy'

export function installProductUpdaterNetworkBoundary(
  productRepository: string | null,
  getMode: () => ProductUpdaterNetworkMode,
  executor?: ProductUpdaterHttpExecutor | null,
  getLocalFeedUrl: () => string | null = () => null,
  getAdditionalReleaseControlUrls: () => readonly string[] = () => [],
  getReleaseFeedUrl: () => string | null = () => null,
  getAuthorityEpoch: () => number = () => 0
): void {
  const updaterSession = session.fromPartition('electron-updater', { cache: false })
  const authorizedRedirectUrls = new Map<string, number>()
  const normalizeUrl = (url: string): string | null => {
    try {
      return new URL(url).href
    } catch {
      return null
    }
  }
  const isAuthorizedRedirectUrl = (url: string): boolean => {
    const normalizedUrl = normalizeUrl(url)
    return (
      normalizedUrl !== null && authorizedRedirectUrls.get(normalizedUrl) === getAuthorityEpoch()
    )
  }
  const authorizeRedirectUrl = (url: string, epoch: number): void => {
    const normalizedUrl = normalizeUrl(url)
    if (
      normalizedUrl !== null &&
      epoch === getAuthorityEpoch() &&
      isAllowedProductUpdaterRedirectTarget(
        normalizedUrl,
        productRepository,
        getMode(),
        getLocalFeedUrl(),
        getReleaseFeedUrl()
      )
    ) {
      authorizedRedirectUrls.set(normalizedUrl, epoch)
    }
  }
  updaterSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    callback({
      cancel:
        !isAuthorizedRedirectUrl(details.url) &&
        !isAllowedProductUpdaterRequest(
          details.url,
          productRepository,
          getMode(),
          getLocalFeedUrl(),
          getAdditionalReleaseControlUrls(),
          getReleaseFeedUrl()
        )
    })
  })
  updaterSession.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
    const localFeedUrl = getLocalFeedUrl()
    const mode = getMode()
    const isArtifact =
      isFinalUpdaterArtifactUrl(
        details.url,
        productRepository,
        mode,
        localFeedUrl,
        getReleaseFeedUrl()
      ) ||
      (isAuthorizedRedirectUrl(details.url) &&
        isFinalUpdaterRedirectArtifactUrl(
          details.url,
          productRepository,
          mode,
          localFeedUrl,
          getReleaseFeedUrl()
        ))
    const isRedirect = details.statusCode >= 300 && details.statusCode < 400
    const isSuccessfulArtifactResponse = details.statusCode === 200 || details.statusCode === 206
    callback({
      cancel:
        isArtifact &&
        !isRedirect &&
        (!isSuccessfulArtifactResponse ||
          getBoundedArtifactContentLength(details.responseHeaders) === null)
    })
  })
  if (executor) {
    installProductUpdaterHttpExecutorBoundary(
      executor,
      productRepository,
      getMode,
      getLocalFeedUrl,
      getReleaseFeedUrl,
      getAuthorityEpoch,
      authorizeRedirectUrl
    )
  } else if (executor === null) {
    throw new Error('electron-updater HTTP executor is unavailable')
  }
}
